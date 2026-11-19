import type { AppContext } from "../context.js";
import { runAgyCommand } from "../agy-runner.js";
import { refreshCliCapabilities } from "../cli-capabilities.js";
import { isZh, settingsFor } from "../domain/settings.js";
import { resolveLang, t } from "../i18n/index.js";
import { createMainKeyboard } from "../keyboards.js";
import { escapeHtml } from "../telegram.js";
import type { ChatId, InlineKeyboardMarkup, PendingInputKind } from "../types.js";
import { formatEnvDoctorHtml, inspectEnvironment } from "../infra/env-doctor.js";
import { enqueueJob } from "../usecases/enqueue.js";
import { handleMcpCommand } from "../usecases/mcp-command.js";
import { refreshModels } from "../usecases/model-selection.js";
import { handleSkillsCommand } from "../usecases/skills-command.js";
import {
  backKeyboard,
  button,
  cliOptionsKeyboard,
  cliToolsKeyboard,
  directivesKeyboard,
  effortKeyboard,
  guideKeyboard,
  mainInlineKeyboard,
  mcpKeyboard,
  menuProfileKeyboard,
  modeKeyboard,
  modeSandboxKeyboard,
  modelKeyboard,
  outputFormatKeyboard,
  pendingInputKeyboard,
  pluginsKeyboard,
  remoteControlKeyboard,
  resumeKeyboard,
  sandboxKeyboard,
  sttKeyboard,
  sttLangKeyboard,
  sttProviderKeyboard,
  sttWhisperModelKeyboard,
  ttsKeyboard,
  ttsModeKeyboard,
  ttsVoiceKeyboard,
  verboseKeyboard,
  voiceSettingsKeyboard,
  workspaceKeyboard,
} from "./inline-keyboards.js";
import { controlPanelHtml, resumeMessageText, sessionText } from "./messages.js";
import { reply, replyWithHtml } from "./reply.js";

export function showMain(context: AppContext, chatId: ChatId, messageId?: number): Promise<void> {
  return showMainInternal(context, chatId, messageId);
}

async function showMainInternal(context: AppContext, chatId: ChatId, messageId?: number): Promise<void> {
  const text = controlPanelHtml(context, chatId);
  const keyboard = mainInlineKeyboard(context, chatId);
  if (messageId) {
    await context.telegram.editMessageText(chatId, messageId, text, keyboard, "HTML");
    await context.state.setSession(chatId, { lastMenuMessageId: messageId, activeMenuScreen: "main", pendingInput: null });
  } else {
    try {
      const sent = await context.telegram.sendMessage(chatId, text, keyboard, "HTML");
      if (sent?.message_id) {
        await context.state.setSession(chatId, { lastMenuMessageId: sent.message_id, activeMenuScreen: "main", pendingInput: null });
      }
    } catch {
      await reply(context, chatId, text.replace(/<[^>]+>/g, ""), keyboard);
    }
  }
}

export async function refreshActiveMenu(context: AppContext, chatId: ChatId): Promise<void> {
  const session = context.state.session(chatId);
  if (!session?.lastMenuMessageId || !session.activeMenuScreen) return;
  let keyboard: InlineKeyboardMarkup | undefined;
  if (session.activeMenuScreen === "main") {
    keyboard = mainInlineKeyboard(context, chatId);
  } else if (session.activeMenuScreen === "clitools") {
    keyboard = cliToolsKeyboard(context, chatId);
  } else if (session.activeMenuScreen === "modesandbox") {
    keyboard = modeSandboxKeyboard(context, chatId);
  }
  if (!keyboard) return;
  try {
    await context.telegram.editMessageReplyMarkup(chatId, session.lastMenuMessageId, keyboard);
  } catch {
    // Silently ignore if message cannot be modified or was deleted
  }
}

export async function showResumeMenu(context: AppContext, chatId: ChatId, page = 0, messageId?: number): Promise<void> {
  const lang = resolveLang(settingsFor(context, chatId), context, chatId);
  const zh = lang === "zh";
  const pageData = context.convDb.getConversations(page, 5);
  const text = resumeMessageText(pageData, zh);
  const keyboard = resumeKeyboard(pageData.page, pageData.totalPages, pageData.items, zh);
  if (messageId) {
    try {
      await context.telegram.editMessageText(chatId, messageId, text, keyboard, "HTML");
    } catch {
      await context.telegram.editMessageText(chatId, messageId, text.replace(/<[^>]+>/g, ""), keyboard).catch(() => undefined);
    }
  } else {
    await replyWithHtml(context, chatId, text, keyboard);
  }
}

export type CliCommand = "models" | "agents" | "changelog" | "plugins" | "help" | "version" | "mcp" | "skills";
export const CLI_COMMANDS: CliCommand[] = ["models", "agents", "changelog", "plugins", "help", "version", "mcp", "skills"];

export function cliCommandArgs(command: CliCommand): string[] {
  if (command === "models") return ["models"];
  if (command === "agents") return ["agents"];
  if (command === "changelog") return ["changelog"];
  if (command === "plugins") return ["plugins", "list"];
  if (command === "mcp") return ["mcp", "list"];
  if (command === "skills") return ["--print", "/skills"];
  if (command === "version") return ["--version"];
  return ["--help"];
}

function truncateText(text: string, maxChars: number): string {
  const chars = Array.from(text);
  return chars.length <= maxChars ? text : chars.slice(0, maxChars).join("");
}

export function formatChangelogSummary(output: string): string {
  const lines = output.split(/\r?\n/);
  const versionHeader = /^(\d+\.\d+\.\d+):\s*$/;
  let end = lines.length;
  let seenFirst = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (versionHeader.test(lines[i].trim())) {
      if (seenFirst) {
        end = i;
        break;
      }
      seenFirst = true;
    }
  }
  const section = lines.slice(0, end);
  while (section.length && !section[section.length - 1].trim()) section.pop();
  if (!seenFirst) {
    const text = output.trim();
    return text.length > 3000 ? `${truncateText(text, 3000)}\n…` : text;
  }
  const version = section[0].trim().replace(/:$/, "");
  const bullets = section.filter((line) => line.trimStart().startsWith("·"));
  const shown = bullets.slice(0, 5).map((line) => {
    const text = line.trim();
    return text.length > 300 ? `${truncateText(text, 300)}…` : text;
  });
  const totalLines = lines.filter((line) => line.trim()).length;
  let result = `${version}:\n${shown.join("\n")}`;
  if (bullets.length > shown.length) {
    result += `\n…（该版本还有 ${bullets.length - shown.length} 条未显示）`;
  }
  result += `\n\n仅显示最新版本 ${version}，全文共 ${totalLines} 行。完整日志请在终端运行 agy changelog 查看。`;
  return result;
}

export async function cliOutput(context: AppContext, chatId: ChatId, messageId: number, command: CliCommand): Promise<void> {
  const currentSettings = settingsFor(context, chatId);
  const zh = isZh(currentSettings, context, chatId);
  if (command === "skills") {
    await context.telegram.editMessageText(chatId, messageId, zh ? "⏳ 正在加载 AGY 技能列表..." : "Loading AGY skills...");
    await handleSkillsCommand(context, chatId, undefined, messageId);
    return;
  }
  if (command === "mcp") {
    await context.telegram.editMessageText(chatId, messageId, zh ? "⏳ 正在读取 MCP 服务..." : "Reading MCP servers...");
    await handleMcpCommand(context, chatId, messageId);
    return;
  }
  const cmdStr = `agy ${cliCommandArgs(command).join(" ")}`;
  await context.telegram.editMessageText(chatId, messageId, zh ? `⏳ 正在执行 ${cmdStr}...` : `Running ${cmdStr}...`);
  try {
    const output = await runAgyCommand(context.config.agy, cliCommandArgs(command));
    let title = `AGY ${command}`;
    if (command === "help") {
      title = zh ? "📖 AGY CLI 帮助文档" : "AGY CLI help";
    } else if (command === "plugins") {
      title = zh ? "🧩 AGY 插件列表" : "AGY plugins";
    }
    let body = command === "changelog" ? formatChangelogSummary(output) : output;
    if (command === "plugins") {
      const trimmed = output?.trim();
      if (!trimmed || trimmed === "No plugins installed." || /no plugins/i.test(trimmed)) {
        body = zh ? "🧩 当前未安装任何插件 (No plugins installed)。" : "No plugins installed.";
      }
    }
    await reply(context, chatId, `${title}\n\n${body}`, createMainKeyboard(currentSettings));
  } catch (error) {
    const errMsg = zh ? `无法读取 AGY ${command}: ` : `Could not read AGY ${command}: `;
    await reply(context, chatId, `${errMsg}${(error as Error).message}`, createMainKeyboard(currentSettings));
  }
}

const INTERACTIVE_CLI_KINDS = new Set<string>([
  "project",
  "agent",
  "add-dir",
  "json-schema",
  "log-file",
  "print-timeout",
  "custom-agy",
  "directive-plan",
  "directive-boost",
  "directive-goal",
  "directive-grill-me",
  "directive-learn",
  "plugin-install",
  "plugin-uninstall",
  "plugin-enable",
  "plugin-disable",
  "mcp-enable",
  "mcp-disable",
  "git-commit",
  "git-clone",
]);

export async function showPendingInputPrompt(
  context: AppContext,
  chatId: ChatId,
  messageId: number,
  kind: PendingInputKind,
  sendNewMessage = false,
): Promise<void> {
  const settings = settingsFor(context, chatId);
  const lang = resolveLang(settings, context, chatId);

  const currentMap: Partial<Record<PendingInputKind, string>> = {
    project: settings.project || t(lang, "common.default"),
    agent: settings.agent || t(lang, "common.default"),
    "add-dir": settings.addDirs?.length ? settings.addDirs.join(", ") : t(lang, "common.none"),
    "json-schema": settings.jsonSchema || t(lang, "common.none"),
    "log-file": settings.logFile || t(lang, "common.none"),
    "print-timeout": settings.printTimeout || t(lang, "common.default"),
    "custom-agy": "/agy ...",
  };

  const titleKeyMap: Record<PendingInputKind, { title: Parameters<typeof t>[1]; hint: Parameters<typeof t>[1]; isDirective?: boolean }> = {
    project: { title: "input.projectTitle", hint: "input.projectHint" },
    agent: { title: "input.agentTitle", hint: "input.agentHint" },
    "add-dir": { title: "input.addDirTitle", hint: "input.addDirHint" },
    "json-schema": { title: "input.jsonSchemaTitle", hint: "input.jsonSchemaHint" },
    "log-file": { title: "input.logFileTitle", hint: "input.logFileHint" },
    "print-timeout": { title: "input.printTimeoutTitle", hint: "input.printTimeoutHint" },
    "custom-agy": { title: "input.customAgyTitle", hint: "input.customAgyHint" },
    "directive-plan": { title: "input.directivePlanTitle", hint: "input.directivePlanHint", isDirective: true },
    "directive-boost": { title: "input.directiveBoostTitle", hint: "input.directiveBoostHint", isDirective: true },
    "directive-goal": { title: "input.directiveGoalTitle", hint: "input.directiveGoalHint", isDirective: true },
    "directive-grill-me": { title: "input.directiveGrillTitle", hint: "input.directiveGrillHint", isDirective: true },
    "directive-learn": { title: "input.directiveLearnTitle", hint: "input.directiveLearnHint", isDirective: true },
    "plugin-install": { title: "input.pluginInstallTitle", hint: "input.pluginInstallHint", isDirective: true },
    "plugin-uninstall": { title: "input.pluginUninstallTitle", hint: "input.pluginUninstallHint", isDirective: true },
    "plugin-enable": { title: "input.pluginEnableTitle", hint: "input.pluginEnableHint", isDirective: true },
    "plugin-disable": { title: "input.pluginDisableTitle", hint: "input.pluginDisableHint", isDirective: true },
    "mcp-enable": { title: "input.mcpEnableTitle", hint: "input.mcpEnableHint", isDirective: true },
    "mcp-disable": { title: "input.mcpDisableTitle", hint: "input.mcpDisableHint", isDirective: true },
    "git-commit": { title: "input.gitCommitTitle", hint: "input.gitCommitHint", isDirective: true },
    "git-clone": { title: "input.gitCloneTitle", hint: "input.gitCloneHint", isDirective: true },
  };

  const keys = titleKeyMap[kind];
  const current = currentMap[kind] || "";
  const hasValue =
    (kind === "project" && Boolean(settings.project)) ||
    (kind === "agent" && Boolean(settings.agent)) ||
    (kind === "add-dir" && Boolean(settings.addDirs?.length)) ||
    (kind === "json-schema" && Boolean(settings.jsonSchema)) ||
    (kind === "log-file" && Boolean(settings.logFile)) ||
    (kind === "print-timeout" && Boolean(settings.printTimeout));

  const body = keys.isDirective
    ? t(lang, "input.directivePrompt", {
        title: t(lang, keys.title),
        hint: t(lang, keys.hint),
      })
    : t(lang, "input.prompt", {
        title: t(lang, keys.title),
        current: escapeHtml(current),
        hint: t(lang, keys.hint),
      });

  const kb = pendingInputKeyboard(kind, hasValue, lang);
  let targetMsgId = messageId;
  if (sendNewMessage || !messageId) {
    const sent = await context.telegram.sendMessage(chatId, body, kb, "HTML");
    targetMsgId = sent?.message_id || messageId;
  } else {
    try {
      await context.telegram.editMessageText(chatId, messageId, body, kb, "HTML");
    } catch {
      const sent = await context.telegram.sendMessage(chatId, body, kb, "HTML");
      targetMsgId = sent?.message_id || messageId;
    }
  }

  const currentSession = context.state.session(chatId) || {};
  await context.state.setSession(chatId, {
    ...currentSession,
    pendingInput: { kind, messageId: targetMsgId },
  });
}

export async function showCliOption(context: AppContext, chatId: ChatId, messageId: number, option: string): Promise<void> {
  if (INTERACTIVE_CLI_KINDS.has(option)) {
    await showPendingInputPrompt(context, chatId, messageId, option as PendingInputKind);
    return;
  }
  const lang = resolveLang(settingsFor(context, chatId), context, chatId);
  const examples: Record<string, string> = {
    continue: "/agy --continue --print \"prompt\"",
    "new-project": "/agy --new-project --print \"prompt\"",
    "output-format": "/agy --output-format text --print \"prompt\"",
    "disable-slash": "/agy --disable-slash-commands --print \"prompt\"",
    conversation: "/agy --conversation CONVERSATION_ID --print \"prompt\"",
    prompt: "/agy --print \"prompt\" --output-format stream-json",
  };
  await context.telegram.editMessageText(
    chatId,
    messageId,
    `${lang === "zh" ? "可使用以下自定义命令：" : "Use this custom command:"}\n\n${examples[option] || "/agy --help"}`,
    backKeyboard(lang === "zh"),
  );
}

export async function showMenu(context: AppContext, chatId: ChatId, messageId: number, kind: string, page = 0): Promise<void> {
  const settings = settingsFor(context, chatId);
  const lang = resolveLang(settings, context, chatId);
  const zh = lang === "zh";
  if (kind === "main") return showMain(context, chatId, messageId);
  await context.state.setSession(chatId, { activeMenuScreen: kind, pendingInput: null });
  if (kind === "guide" || kind.startsWith("guide:")) {
    const rawTab = kind.includes(":") ? kind.split(":")[1] : "new";
    const tab = (rawTab === "directives" || rawTab === "session" || rawTab === "tools" ? rawTab : "new") as
      | "new"
      | "directives"
      | "session"
      | "tools";
    const screenKeyMap = {
      new: "guide.screenNew",
      directives: "guide.screenDirectives",
      session: "guide.screenSession",
      tools: "guide.screenTools",
    } as const;
    return context.telegram.editMessageText(chatId, messageId, t(lang, screenKeyMap[tab]), guideKeyboard(tab, lang), "HTML");
  }
  if (kind === "directives") {
    return context.telegram.editMessageText(chatId, messageId, t(lang, "directives.title"), directivesKeyboard(lang), "HTML");
  }
  if (kind === "model" || kind === "models") {
    if (page === 0) {
      await Promise.all([
        refreshModels(context).catch(() => undefined),
        refreshCliCapabilities(context.config.agy).catch(() => undefined),
      ]);
    }
    return context.telegram.editMessageText(chatId, messageId, t(lang, "model.select"), modelKeyboard(context, chatId, page), "HTML");
  }
  if (kind === "effort") {
    await refreshCliCapabilities(context.config.agy).catch(() => undefined);
    return context.telegram.editMessageText(chatId, messageId, t(lang, "effort.select"), effortKeyboard(context, chatId), "HTML");
  }
  if (kind === "mode") {
    await refreshCliCapabilities(context.config.agy).catch(() => undefined);
    return context.telegram.editMessageText(chatId, messageId, t(lang, "mode.select"), modeKeyboard(context, chatId), "HTML");
  }
  if (kind === "sandbox") {
    return context.telegram.editMessageText(
      chatId,
      messageId,
      t(lang, "sandbox.status", { state: settings.sandbox ? t(lang, "common.enabled") : t(lang, "common.disabled") }),
      sandboxKeyboard(context, chatId),
      "HTML",
    );
  }
  if (kind === "verbose") return context.telegram.editMessageText(chatId, messageId, t(lang, "verbose.select"), verboseKeyboard(context, chatId), "HTML");
  if (kind === "workspace" || kind === "workspaces") return context.telegram.editMessageText(chatId, messageId, t(lang, "ws.select"), workspaceKeyboard(context, chatId, page));
  if (kind === "session") return context.telegram.editMessageText(chatId, messageId, sessionText(context, chatId), backKeyboard(zh));
  if (kind === "resume") return showResumeMenu(context, chatId, page, messageId);
  if (kind === "usage") { enqueueJob(context, chatId, { kind: "usage" }); return; }
  if (kind === "credits") { enqueueJob(context, chatId, { kind: "credits" }); return; }
  if (kind === "cli") return context.telegram.editMessageText(chatId, messageId, t(lang, "cliopts.title"), cliOptionsKeyboard(context, chatId), "HTML");
  if (kind === "output") return context.telegram.editMessageText(chatId, messageId, t(lang, "cliopts.outputSelect"), outputFormatKeyboard(context, chatId));
  if (kind === "custom") return showPendingInputPrompt(context, chatId, messageId, "custom-agy");
  if (kind === "plugins") return context.telegram.editMessageText(chatId, messageId, t(lang, "plugins.screen"), pluginsKeyboard(lang), "HTML");
  if (kind === "mcp") {
    return context.telegram.editMessageText(
      chatId,
      messageId,
      t(lang, "mcp.screen"),
      mcpKeyboard(lang),
      "HTML",
    );
  }
  if (kind === "skills") {
    await handleSkillsCommand(context, chatId, undefined, messageId);
    return;
  }
  if (kind === "profile") {
    const current = settings.menuProfile || "mixed";
    return context.telegram.editMessageText(chatId, messageId, t(lang, "profile.screen"), menuProfileKeyboard(current, lang), "HTML");
  }
  if (kind === "lang" || kind === "language") {
    const keyboard = {
      inline_keyboard: [
        [
          button(`${settings.language !== "zh" ? "✅ " : ""}🇬🇧 English (Default)`, "set:lang:en"),
          button(`${settings.language === "zh" ? "✅ " : ""}🇨🇳 中文 (Chinese)`, "set:lang:zh"),
        ],
        [button(t(lang, "common.back"), "menu:main")],
      ],
    };
    return context.telegram.editMessageText(chatId, messageId, t(lang, "lang.screen"), keyboard, "HTML");
  }
  if (kind === "modesandbox") return context.telegram.editMessageText(chatId, messageId, t(lang, "modesandbox.title"), modeSandboxKeyboard(context, chatId), "HTML");
  if (kind === "clitools") return context.telegram.editMessageText(chatId, messageId, t(lang, "clitools.title"), cliToolsKeyboard(context, chatId), "HTML");
  if (kind === "doctor") {
    const report = inspectEnvironment(context.config);
    return context.telegram.editMessageText(
      chatId,
      messageId,
      formatEnvDoctorHtml(report, lang),
      {
        inline_keyboard: [
          [button(t(lang, "common.refresh"), "menu:doctor"), button(t(lang, "common.backToCliTools"), "menu:clitools")],
          [button(t(lang, "common.backToMenu"), "menu:main")],
        ],
      },
      "HTML",
    );
  }
  if (kind === "voice") return context.telegram.editMessageText(chatId, messageId, t(lang, "voice.screen"), voiceSettingsKeyboard(context, chatId));
  if (kind === "stt") return context.telegram.editMessageText(chatId, messageId, t(lang, "stt.screen"), sttKeyboard(context, chatId));
  if (kind === "stt:provider") return context.telegram.editMessageText(chatId, messageId, t(lang, "stt.providerScreen"), sttProviderKeyboard(context, chatId));
  if (kind === "stt:whisper") return context.telegram.editMessageText(chatId, messageId, t(lang, "stt.whisperScreen"), sttWhisperModelKeyboard(context, chatId));
  if (kind === "stt:lang") return context.telegram.editMessageText(chatId, messageId, t(lang, "stt.langScreen"), sttLangKeyboard(context, chatId));
  if (kind === "tts") return context.telegram.editMessageText(chatId, messageId, t(lang, "tts.screen"), ttsKeyboard(context, chatId));
  if (kind === "tts:mode") return context.telegram.editMessageText(chatId, messageId, t(lang, "tts.modeScreen"), ttsModeKeyboard(context, chatId));
  if (kind === "tts:voice") return context.telegram.editMessageText(chatId, messageId, t(lang, "tts.voiceScreen"), ttsVoiceKeyboard(context, chatId));
  if (kind === "remote-control") {
    let active = false;
    let statusText = "";
    try {
      const output = await runAgyCommand(context.config.agy, ["remote-control", "status"], 10_000);
      active = /Daemon status:\s*active/i.test(output);
      const instanceMatch = output.match(/Instance name:\s*(.+)/);
      const instanceLine = instanceMatch ? instanceMatch[1].trim() : "";
      const sinceMatch = output.match(/Active since:\s*(.+)/);
      const sinceLine = sinceMatch ? sinceMatch[1].trim() : "";
      if (active) {
        statusText = t(lang, "rc.active", {
          instance: escapeHtml(instanceLine),
          since: sinceLine ? `\n${zh ? "启动时间" : "Since"}: ${escapeHtml(sinceLine)}` : "",
        });
      } else {
        statusText = t(lang, "rc.inactive");
      }
    } catch {
      statusText = t(lang, "rc.error");
    }
    return context.telegram.editMessageText(chatId, messageId, statusText, remoteControlKeyboard(active, zh), "HTML");
  }
}
