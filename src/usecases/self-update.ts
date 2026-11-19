import { execFile, spawn } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { AppContext } from "../context.js";
import { createMainKeyboard } from "../keyboards.js";
import { backKeyboard, button } from "../ui/inline-keyboards.js";
import { isZh, settingsFor } from "../domain/settings.js";
import { reply, replyWithHtml } from "../ui/reply.js";
import { escapeHtml } from "../telegram.js";
import type { ChatId, InlineKeyboardMarkup } from "../types.js";

const execFileAsync = promisify(execFile);
const BOT_ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function expandHome(inputPath: string): string {
  const trimmed = inputPath.trim();
  if (trimmed === "~" || trimmed.startsWith("~/")) {
    return path.join(os.homedir() || process.env.HOME || "", trimmed.slice(trimmed === "~" ? 1 : 2));
  }
  return path.resolve(trimmed);
}

async function isGitDirectory(dir: string): Promise<boolean> {
  if (!dir || !fsSync.existsSync(dir)) return false;
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: dir });
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

/**
 * Resolves the Git repository directory for self-updating the bot.
 * Supports forked repos even when the bot binary is installed globally via `npm i -g`.
 */
export async function resolveBotGitRepoDir(env: Record<string, string | undefined> = process.env): Promise<{ repoDir: string | null; checkedPaths: string[] }> {
  const candidates: string[] = [];
  if (env.BOT_REPO_DIR?.trim()) {
    candidates.push(expandHome(env.BOT_REPO_DIR));
  }
  candidates.push(BOT_ROOT_DIR);
  const cwd = process.cwd();
  if (!candidates.includes(cwd)) candidates.push(cwd);

  const home = os.homedir() || env.HOME;
  if (home) {
    const defaultClone = path.join(home, "antigravity-cli-telegram-bot");
    if (!candidates.includes(defaultClone)) candidates.push(defaultClone);
  }

  for (const candidate of candidates) {
    if (await isGitDirectory(candidate)) {
      return { repoDir: candidate, checkedPaths: candidates };
    }
  }
  return { repoDir: null, checkedPaths: candidates };
}

export function restartNoticePath(context: AppContext): string {
  return path.join(path.dirname(context.config.stateFile), "pending_restart_notice.json");
}

export async function writeRestartNotice(context: AppContext, notice: Omit<{ chatId: string; reason: "update" | "restart"; commit?: string; timestamp?: number }, "timestamp">): Promise<void> {
  await fs.writeFile(restartNoticePath(context), JSON.stringify({ ...notice, timestamp: Date.now() })).catch(() => undefined);
}

export function scheduleServiceRestart(delayMs: number): void {
  if (process.platform === "linux") {
    setTimeout(() => {
      // NOTE: the bot runs as a *system* service (agy-telegram.service), not a
      // user service, so `--user` never restarts it. sudo is passwordless for
      // the ubuntu user on this host.
      spawn("sudo", ["systemctl", "restart", "agy-telegram.service"], { detached: true, stdio: "ignore" }).unref();
    }, delayMs);
  }
}

export async function updateBot(context: AppContext, chatId: ChatId, messageId?: number): Promise<void> {
  const settings = settingsFor(context, chatId);
  const zh = isZh(settings, context, chatId);
  const notify = async (text: string, isHtml = false): Promise<void> => {
    const menuBackKeyboard: InlineKeyboardMarkup = { inline_keyboard: [[button(zh ? "‹ 返回主菜单" : "‹ Back to Menu", "menu:main")]] };
    if (messageId) {
      if (isHtml) {
        await context.telegram.editMessageText(chatId, messageId, text, menuBackKeyboard, "HTML").catch(() => undefined);
      } else {
        await context.telegram.editMessageText(chatId, messageId, text, backKeyboard(zh)).catch(() => undefined);
      }
    } else {
      if (isHtml) {
        await replyWithHtml(context, chatId, text, createMainKeyboard(settings));
      } else {
        await reply(context, chatId, text, createMainKeyboard(settings));
      }
    }
  };

  if (!context.config.telegram.allowBotUpdate) {
    await notify(
      zh
        ? "⚠️ <b>已禁用通过 Telegram 远程更新 Bot。</b>\n\n如需开启，请在环境变量中设置 <code>ALLOW_BOT_UPDATE=true</code>。"
        : "⚠️ <b>Bot updates via Telegram are disabled.</b>\n\nTo enable remote updates, set <code>ALLOW_BOT_UPDATE=true</code> in your environment.",
      true,
    );
    return;
  }

  try {
    const checkingText = zh ? "🔍 正在检查你的 Git 仓库更新..." : "🔍 Checking for updates from your Git repository...";
    if (messageId) {
      await context.telegram.editMessageText(chatId, messageId, checkingText).catch(() => undefined);
    } else {
      await reply(context, chatId, checkingText);
    }

    const { repoDir, checkedPaths } = await resolveBotGitRepoDir();

    if (!repoDir) {
      const pathsHtml = checkedPaths.map((p) => `• <code>${escapeHtml(p)}</code>`).join("\n");
      await notify(
        zh
          ? `ℹ️ <b>未在运行目录找到 <code>.git</code> 仓库，无法执行 <code>git pull</code>。</b>\n\n已检查以下路径：\n${pathsHtml}\n\n<b>如果你部署了自己的 Fork 仓库：</b>\n• <b>VPS / 自建服务器</b>：在 <code>.env</code> 中添加一行指定你的 clone 目录：\n  <code>BOT_REPO_DIR=/你的/fork仓库路径</code>\n  （可选指定远端/分支：<code>BOT_REPO_REMOTE=origin</code>、<code>BOT_REPO_BRANCH=main</code>）\n• <b>云端预览容器</b>：导入后的容器目录本身不含 <code>.git</code>，需把修改推送到你的 GitHub Fork 后在服务器拉取。`
          : `ℹ️ <b>No <code>.git</code> repository found for self-update.</b>\n\nChecked paths:\n${pathsHtml}\n\n<b>If you deployed your own forked repo:</b>\n• Set <code>BOT_REPO_DIR=/path/to/your-forked-repo</code> in <code>.env</code> (optional: <code>BOT_REPO_REMOTE=origin</code>, <code>BOT_REPO_BRANCH=main</code>).\n• Cloud preview sandboxes do not include <code>.git</code> metadata.`,
        true,
      );
      return;
    }

    const remoteName = (process.env.BOT_REPO_REMOTE || "origin").trim() || "origin";
    let remoteUrl = remoteName;
    try {
      const { stdout: urlOut } = await execFileAsync("git", ["remote", "get-url", remoteName], { cwd: repoDir });
      if (urlOut.trim()) remoteUrl = urlOut.trim();
    } catch {
      // Fallback to remoteName
    }

    const { stdout: branchOut } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoDir });
    const currentBranch = (process.env.BOT_REPO_BRANCH || "").trim() || branchOut.trim();

    await execFileAsync("git", ["fetch", remoteName, currentBranch], { cwd: repoDir });

    const { stdout: localHead } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoDir });
    const { stdout: remoteHead } = await execFileAsync("git", ["rev-parse", `${remoteName}/${currentBranch}`], { cwd: repoDir });

    const localHash = localHead.trim();
    const remoteHash = remoteHead.trim();

    if (localHash === remoteHash) {
      const { stdout: logMsg } = await execFileAsync("git", ["log", "-1", "--pretty=format:%h - %s"], { cwd: repoDir });
      await notify(
        zh
          ? `✅ <b>Bot 已是最新版本！</b>\n\n仓库：<code>${escapeHtml(remoteUrl)}</code>\n分支：<code>${escapeHtml(currentBranch)}</code>\n当前提交：<code>${escapeHtml(logMsg.trim())}</code>`
          : `✅ <b>Bot is up to date!</b>\n\nRepo: <code>${escapeHtml(remoteUrl)}</code>\nBranch: <code>${escapeHtml(currentBranch)}</code>\nCurrent commit: <code>${escapeHtml(logMsg.trim())}</code>`,
        true,
      );
      return;
    }

    const pullingText = zh
      ? `⬇️ 正在从 <code>${escapeHtml(remoteName)}/${escapeHtml(currentBranch)}</code> 拉取最新代码...`
      : `⬇️ Pulling latest changes from <code>${escapeHtml(remoteName)}/${escapeHtml(currentBranch)}</code>...`;
    if (messageId) {
      await context.telegram.editMessageText(chatId, messageId, pullingText, undefined, "HTML").catch(() => undefined);
    } else {
      await replyWithHtml(context, chatId, pullingText);
    }

    await execFileAsync("git", ["pull", "--ff-only", remoteName, currentBranch], { cwd: repoDir });

    const buildingText = zh ? "🔨 正在编译 TypeScript 项目..." : "🔨 Building project with TypeScript...";
    if (messageId) {
      await context.telegram.editMessageText(chatId, messageId, buildingText).catch(() => undefined);
    } else {
      await reply(context, chatId, buildingText);
    }

    await execFileAsync("npm", ["run", "build"], { cwd: repoDir });

    // If the running bot was installed globally into node_modules while source lives in repoDir, refresh global link/install
    if (path.resolve(repoDir) !== path.resolve(BOT_ROOT_DIR) && BOT_ROOT_DIR.includes("node_modules")) {
      await execFileAsync("npm", ["install", "-g", "."], { cwd: repoDir }).catch(() => undefined);
    }

    const { stdout: newLogMsg } = await execFileAsync("git", ["log", "-1", "--pretty=format:%h - %s"], { cwd: repoDir });

    await writeRestartNotice(context, { chatId: String(chatId), reason: "update", commit: newLogMsg.trim() });

    await notify(
      zh
        ? `🚀 <b>更新完成！</b>\n\n仓库：<code>${escapeHtml(remoteUrl)}</code>\n分支：<code>${escapeHtml(currentBranch)}</code>\n已更新至：<code>${escapeHtml(newLogMsg.trim())}</code>\n\n<i>正在重启 Bot 服务...</i>`
        : `🚀 <b>Update complete!</b>\n\nRepo: <code>${escapeHtml(remoteUrl)}</code>\nBranch: <code>${escapeHtml(currentBranch)}</code>\nUpdated to: <code>${escapeHtml(newLogMsg.trim())}</code>\n\n<i>Restarting bot service...</i>`,
      true,
    );

    scheduleServiceRestart(1500);
  } catch (error) {
    await notify(
      zh
        ? `❌ <b>更新失败：</b>\n<code>${escapeHtml((error as Error).message)}</code>`
        : `❌ <b>Update failed:</b>\n<code>${escapeHtml((error as Error).message)}</code>`,
      true,
    );
  }
}
