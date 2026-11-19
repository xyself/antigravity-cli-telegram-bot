import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { AppContext } from "../context.js";
import { settingsFor } from "../domain/settings.js";
import { isWithin } from "../domain/workspace.js";
import { resolveLang, t, type Lang } from "../i18n/index.js";
import { escapeHtml } from "../telegram.js";
import type { ChatId, InlineKeyboardMarkup } from "../types.js";
import { button } from "../ui/inline-keyboards.js";
import { replyWithHtml } from "../ui/reply.js";
import { runGitCommand } from "./diff-command.js";

const execFileAsync = promisify(execFile);

export interface WorkspaceGitSummary {
  branch: string;
  changedFiles: string[];
  totalChanged: number;
}

export async function getWorkspaceGitSummary(workspace: string): Promise<WorkspaceGitSummary | null> {
  if (!workspace || !fs.existsSync(workspace)) return null;
  const check = await runGitCommand(["rev-parse", "--is-inside-work-tree"], workspace);
  if (check.exitCode !== 0) return null;

  const [branchRes, statusRes] = await Promise.all([
    runGitCommand(["rev-parse", "--abbrev-ref", "HEAD"], workspace),
    runGitCommand(["status", "--porcelain"], workspace),
  ]);

  const branch = branchRes.exitCode === 0 && branchRes.stdout ? branchRes.stdout : "HEAD";
  const lines = statusRes.stdout
    ? statusRes.stdout.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean)
    : [];
  const changedFiles = lines
    .map((line) => line.replace(/^[ MARCUD?!]{1,2}\s+/, "").trim())
    .filter(Boolean);

  return {
    branch,
    changedFiles,
    totalChanged: changedFiles.length,
  };
}

export function formatWorkspaceGitSummaryHtml(summary: WorkspaceGitSummary, lang: Lang): string {
  if (summary.totalChanged <= 0) return "";
  const zh = lang === "zh";
  const preview = summary.changedFiles.slice(0, 4).map((f) => `<code>${escapeHtml(f)}</code>`).join(", ");
  const extra = summary.totalChanged > 4 ? (zh ? ` 等共 ${summary.totalChanged} 个文件` : ` +${summary.totalChanged - 4} more`) : "";
  return zh
    ? `📝 <b>工作区变更 (${escapeHtml(summary.branch)})：</b> ${summary.totalChanged} 个文件 (${preview}${extra})`
    : `📝 <b>Workspace changes (${escapeHtml(summary.branch)}):</b> ${summary.totalChanged} file(s) (${preview}${extra})`;
}

export function gitDiffActionsKeyboard(lang: Lang, hasChanges: boolean): InlineKeyboardMarkup {
  const rows = [];
  if (hasChanges) {
    rows.push([
      button(t(lang, "git.commitBtn"), "action:git-commit"),
      button(t(lang, "git.revertBtn"), "action:git-revert-ask"),
    ]);
  }
  rows.push([
    button(t(lang, "git.refreshDiffBtn"), "action:diff"),
    button(t(lang, "common.backToMenu"), "menu:main"),
  ]);
  return { inline_keyboard: rows };
}

function resolveSafeGitWorkspace(context: AppContext, chatId: ChatId): { ok: true; realWorkspace: string } | { ok: false; error: string } {
  const settings = settingsFor(context, chatId);
  const effectiveWorkspace = settings.workspace || context.config.agy.workspace;
  if (!fs.existsSync(effectiveWorkspace)) {
    return { ok: false, error: `Directory not found: <code>${escapeHtml(effectiveWorkspace)}</code>` };
  }
  const realProjectsRoot = fs.existsSync(context.config.agy.projectsRoot)
    ? fs.realpathSync(context.config.agy.projectsRoot)
    : path.resolve(context.config.agy.projectsRoot);
  const realDefault = fs.existsSync(context.config.agy.workspace)
    ? fs.realpathSync(context.config.agy.workspace)
    : path.resolve(context.config.agy.workspace);
  const realWorkspace = fs.realpathSync(effectiveWorkspace);
  if (!isWithin(realWorkspace, realProjectsRoot) && !isWithin(realWorkspace, realDefault)) {
    return { ok: false, error: "Security boundary violation: workspace directory must reside within configured projects root." };
  }
  return { ok: true, realWorkspace };
}

export async function handleGitCommit(context: AppContext, chatId: ChatId, rawMessage: string): Promise<void> {
  const settings = settingsFor(context, chatId);
  const lang = resolveLang(settings, context, chatId);
  const zh = lang === "zh";
  const resolved = resolveSafeGitWorkspace(context, chatId);
  if (!resolved.ok) {
    await replyWithHtml(context, chatId, `⚠️ ${resolved.error}`);
    return;
  }

  const commitMessage = rawMessage.trim() || (zh ? "chore: update via AGY Telegram bot" : "chore: update via AGY Telegram bot");
  const isGit = await runGitCommand(["rev-parse", "--is-inside-work-tree"], resolved.realWorkspace);
  if (isGit.exitCode !== 0) {
    await replyWithHtml(context, chatId, t(lang, "git.notRepo", { path: escapeHtml(resolved.realWorkspace) }));
    return;
  }

  const addRes = await runGitCommand(["add", "-A"], resolved.realWorkspace);
  if (addRes.exitCode !== 0) {
    await replyWithHtml(context, chatId, t(lang, "git.commitFailed", { error: escapeHtml(addRes.stderr || "git add failed") }));
    return;
  }

  const commitRes = await runGitCommand(["commit", "-m", commitMessage], resolved.realWorkspace);
  if (commitRes.exitCode !== 0) {
    const detail = commitRes.stderr || commitRes.stdout || "git commit failed";
    await replyWithHtml(context, chatId, t(lang, "git.commitFailed", { error: escapeHtml(detail) }));
    return;
  }

  const shortLog = await runGitCommand(["log", "-1", "--oneline"], resolved.realWorkspace);
  await replyWithHtml(
    context,
    chatId,
    t(lang, "git.commitSuccess", {
      summary: escapeHtml(shortLog.stdout || commitMessage),
      workspace: escapeHtml(resolved.realWorkspace),
    }),
    { inline_keyboard: [[button(t(lang, "common.backToMenu"), "menu:main")]] },
  );
}

export async function handleGitRevertAsk(context: AppContext, chatId: ChatId, messageId?: number): Promise<void> {
  const lang = resolveLang(settingsFor(context, chatId), context, chatId);
  const resolved = resolveSafeGitWorkspace(context, chatId);
  if (!resolved.ok) {
    await replyWithHtml(context, chatId, `⚠️ ${resolved.error}`);
    return;
  }
  const summary = await getWorkspaceGitSummary(resolved.realWorkspace);
  const count = summary?.totalChanged ?? 0;
  const text = t(lang, "git.revertConfirmPrompt", {
    workspace: escapeHtml(resolved.realWorkspace),
    count,
  });
  const kb: InlineKeyboardMarkup = {
    inline_keyboard: [
      [button(t(lang, "git.revertConfirmBtn"), "action:git-revert-confirm")],
      [button(t(lang, "common.cancelInput"), "action:diff")],
    ],
  };
  if (messageId) {
    await context.telegram.editMessageText(chatId, messageId, text, kb, "HTML").catch(() => undefined);
  } else {
    await replyWithHtml(context, chatId, text, kb);
  }
}

export async function handleGitRevertConfirm(context: AppContext, chatId: ChatId, messageId?: number): Promise<void> {
  const lang = resolveLang(settingsFor(context, chatId), context, chatId);
  const resolved = resolveSafeGitWorkspace(context, chatId);
  if (!resolved.ok) {
    await replyWithHtml(context, chatId, `⚠️ ${resolved.error}`);
    return;
  }
  const isGit = await runGitCommand(["rev-parse", "--is-inside-work-tree"], resolved.realWorkspace);
  if (isGit.exitCode !== 0) {
    const errText = t(lang, "git.notRepo", { path: escapeHtml(resolved.realWorkspace) });
    if (messageId) await context.telegram.editMessageText(chatId, messageId, errText, undefined, "HTML").catch(() => undefined);
    else await replyWithHtml(context, chatId, errText);
    return;
  }

  const checkoutRes = await runGitCommand(["checkout", "--", "."], resolved.realWorkspace);
  const cleanRes = await runGitCommand(["clean", "-fd"], resolved.realWorkspace);

  const ok = checkoutRes.exitCode === 0 && cleanRes.exitCode === 0;
  const text = ok
    ? t(lang, "git.revertSuccess", { workspace: escapeHtml(resolved.realWorkspace) })
    : t(lang, "git.revertFailed", { error: escapeHtml(checkoutRes.stderr || cleanRes.stderr || "git revert failed") });
  const kb: InlineKeyboardMarkup = { inline_keyboard: [[button(t(lang, "common.backToMenu"), "menu:main")]] };

  if (messageId) {
    await context.telegram.editMessageText(chatId, messageId, text, kb, "HTML").catch(() => undefined);
  } else {
    await replyWithHtml(context, chatId, text, kb);
  }
}

export interface GitCloneValidation {
  valid: boolean;
  url?: string;
  repoName?: string;
  error?: string;
}

export function validateGitCloneUrl(rawInput: string): GitCloneValidation {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { valid: false, error: "Empty repository URL." };
  }
  if (trimmed.startsWith("-") || /[\s;&|`$<>\\]/.test(trimmed)) {
    return { valid: false, error: "Invalid characters in Git URL." };
  }
  const isHttpsOrSsh = /^(https?:\/\/|ssh:\/\/|git@[a-zA-Z0-9._-]+:)/i.test(trimmed);
  if (!isHttpsOrSsh) {
    return { valid: false, error: "URL must start with https://, http://, ssh://, or git@host:." };
  }

  const normalized = trimmed.replace(/\/+$/, "");
  const lastSegment = normalized.split(/[/:]/).pop() || "";
  const repoName = lastSegment.replace(/\.git$/i, "").trim();
  if (!repoName || repoName === "." || repoName === ".." || !/^[a-zA-Z0-9._-]+$/.test(repoName)) {
    return { valid: false, error: "Could not derive a valid repository directory name from URL." };
  }

  return { valid: true, url: trimmed, repoName };
}

export async function handleGitClone(context: AppContext, chatId: ChatId, rawUrl: string): Promise<void> {
  const settings = settingsFor(context, chatId);
  const lang = resolveLang(settings, context, chatId);
  const validation = validateGitCloneUrl(rawUrl);
  if (!validation.valid || !validation.url || !validation.repoName) {
    await replyWithHtml(context, chatId, t(lang, "git.cloneInvalid", { error: escapeHtml(validation.error || "Invalid URL") }));
    return;
  }

  const projectsRoot = context.config.agy.projectsRoot;
  await fs.promises.mkdir(projectsRoot, { recursive: true });
  const realRoot = fs.realpathSync(projectsRoot);
  const targetDir = path.resolve(realRoot, validation.repoName);

  if (!isWithin(targetDir, realRoot)) {
    await replyWithHtml(context, chatId, t(lang, "git.cloneInvalid", { error: "Target path escapes projects root." }));
    return;
  }

  if (fs.existsSync(targetDir)) {
    await replyWithHtml(
      context,
      chatId,
      t(lang, "git.cloneExists", { name: escapeHtml(validation.repoName) }),
      {
        inline_keyboard: [
          [button(t(lang, "git.cloneSwitchBtn", { name: validation.repoName }), `set:ws:${validation.repoName}`)],
          [button(t(lang, "common.back"), "menu:workspace")],
        ],
      },
    );
    return;
  }

  const statusMsg = await context.telegram.sendMessage(
    chatId,
    t(lang, "git.cloning", { url: escapeHtml(validation.url), name: escapeHtml(validation.repoName) }),
    undefined,
    "HTML",
  );

  try {
    await execFileAsync("git", ["clone", "--depth", "1", "--", validation.url, targetDir], {
      cwd: realRoot,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const successText = t(lang, "git.cloneSuccess", {
      name: escapeHtml(validation.repoName),
      path: escapeHtml(targetDir),
    });
    const kb: InlineKeyboardMarkup = {
      inline_keyboard: [
        [button(t(lang, "git.cloneSwitchBtn", { name: validation.repoName }), `set:ws:${validation.repoName}`)],
        [button(t(lang, "common.back"), "menu:workspace")],
      ],
    };
    if (statusMsg?.message_id) {
      await context.telegram.editMessageText(chatId, statusMsg.message_id, successText, kb, "HTML").catch(() => undefined);
    } else {
      await replyWithHtml(context, chatId, successText, kb);
    }
  } catch (err: unknown) {
    const error = err as { stderr?: string; message?: string };
    const detail = (error?.stderr || error?.message || "git clone failed").trim().slice(0, 600);
    const failText = t(lang, "git.cloneFailed", { error: escapeHtml(detail) });
    if (statusMsg?.message_id) {
      await context.telegram.editMessageText(chatId, statusMsg.message_id, failText, {
        inline_keyboard: [[button(t(lang, "common.back"), "menu:workspace")]],
      }, "HTML").catch(() => undefined);
    } else {
      await replyWithHtml(context, chatId, failText);
    }
  }
}
