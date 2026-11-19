import { runAgyCommand } from "../agy-runner.js";
import { BOT_COMMANDS, BOT_COMMANDS_ZH } from "../bot.js";
import { isEffort, isMenuProfile, isMode, isVerbose } from "../config.js";
import type { AppContext } from "../context.js";
import { formatRelativeTime, isUuid } from "../db.js";
import { saveSettings, settingsFor, type SettingsOutputFormat } from "../domain/settings.js";
import { resolveWorkspacePath } from "../domain/workspace.js";
import { resolveLang, t } from "../i18n/index.js";
import { createMainKeyboard } from "../keyboards.js";
import { isWhisperInstalled, warmupWhisperLocal } from "../stt/stt-service.js";
import { escapeHtml } from "../telegram.js";
import type { ChatId, TelegramCallbackQuery } from "../types.js";
import {
  backKeyboard,
  button,
  cliOptionsKeyboard,
  cliToolsKeyboard,
  modeSandboxKeyboard,
  sttKeyboard,
  ttsKeyboard,
  verboseKeyboard,
} from "../ui/inline-keyboards.js";
import { sessionInfoHtml } from "../ui/messages.js";
import { reply, replyWithHtml } from "../ui/reply.js";
import { CLI_COMMANDS, cliOutput, showCliOption, showMain, showMenu, showPendingInputPrompt, showResumeMenu, type CliCommand } from "../ui/screens.js";
import { checkCliCompat } from "../usecases/cli-compat-check.js";
import { handleBackupCommand } from "../usecases/backup-command.js";
import { runCustomAgy } from "../usecases/custom-agy.js";
import { persistDefaultSettings } from "../usecases/default-settings.js";
import { handleDiffCommand } from "../usecases/diff-command.js";
import { enqueueJob } from "../usecases/enqueue.js";
import { handleForkCommand } from "../usecases/fork-command.js";
import { handleGitRevertAsk, handleGitRevertConfirm } from "../usecases/git-actions.js";
import { selectModel, syncModelForEffort } from "../usecases/model-selection.js";
import { handleRewindCommand } from "../usecases/rewind-command.js";
import { updateBot } from "../usecases/self-update.js";
import { cleanupSessionTempFiles } from "../usecases/session-cleanup.js";
import { resetForumTopicNameIfAutoRenamed } from "../usecases/topic-reset.js";
import { authorizedCallback } from "./auth.js";
import { parseCallbackAction } from "./callback-parser.js";

export function sessionKeyForCallback(callback: TelegramCallbackQuery): string {
  const msg = callback.message;
  if (!msg) return String(callback.from.id);
  return msg.message_thread_id ? `${msg.chat.id}:${msg.message_thread_id}` : String(msg.chat.id);
}

export async function handleCallback(context: AppContext, callback: TelegramCallbackQuery): Promise<void> {
  if (!authorizedCallback(context.config, callback) || !callback.message || !callback.data) return;
  const action = parseCallbackAction(callback.data);
  if (!action) return;

  const chatId = sessionKeyForCallback(callback);
  const messageId = callback.message.message_id;
  await context.telegram.answerCallbackQuery(callback.id).catch(() => undefined);
  if (action.kind === "noop") return;

  const lang = resolveLang(settingsFor(context, chatId), context, chatId);
  const zh = lang === "zh";

  switch (action.kind) {
    case "menu":
      await showMenu(context, chatId, messageId, action.menu, action.page);
      return;
    case "resume-page":
      await showResumeMenu(context, chatId, action.page, messageId);
      return;
    case "resume-use":
      await resumeConversation(context, chatId, messageId, action.conversationId);
      return;
    case "usage":
      enqueueJob(context, chatId, { kind: "usage" });
      return;
    case "credits":
      enqueueJob(context, chatId, { kind: "credits" });
      return;
    case "context":
      enqueueJob(context, chatId, { kind: "context" });
      return;
    case "compact":
      enqueueJob(context, chatId, { kind: "compact" });
      return;
    case "fork":
      await handleForkCommand(context, chatId, "");
      return;
    case "rewind":
      await handleRewindCommand(context, chatId, "");
      return;
    case "backup":
      await handleBackupCommand(context, chatId);
      return;
    case "diff":
      await handleDiffCommand(context, chatId);
      return;
    case "approve-plan": {
      const settings = settingsFor(context, chatId);
      settings.mode = "accept-edits";
      await saveSettings(context, chatId, settings);
      await replyWithHtml(context, chatId, t(lang, "postturn.planApproved"));
      enqueueJob(context, chatId, {
        kind: "prompt",
        prompt: zh
          ? "方案已批准，请按刚才制定的计划直接开始实施修改。"
          : "Plan approved. Please proceed to implement the plan now.",
      });
      return;
    }
    case "btw-inline": {
      const currentSession = context.state.session(chatId) || {};
      await context.state.setSession(chatId, { ...currentSession, pendingBtw: true });
      await replyWithHtml(context, chatId, t(lang, "btw.ready"));
      return;
    }
    case "git-commit":
      await showPendingInputPrompt(context, chatId, messageId, "git-commit", true);
      return;
    case "git-revert-ask":
      await handleGitRevertAsk(context, chatId, messageId);
      return;
    case "git-revert-confirm":
      await handleGitRevertConfirm(context, chatId, messageId);
      return;
    case "learn-now": {
      const prompt = zh
        ? "/learn 请总结提炼当前会话中的工程规范、偏好和经验，并保存为可复用的技能规则"
        : "/learn Please distill lessons, engineering rules, and user preferences from our recent conversation into reusable skills";
      enqueueJob(context, chatId, { kind: "prompt", prompt });
      return;
    }
    case "cli":
      await handleCliAction(context, chatId, messageId, action.command);
      return;
    case "toggle":
      await toggleSetting(context, chatId, messageId, action.option);
      return;
    case "setdefault":
      await persistDefaultSettings(context, chatId, messageId);
      return;
    case "update-bot":
      await updateBot(context, chatId, messageId);
      return;
    case "new-session": {
      context.queue?.cancelForChat(chatId);
      await cleanupSessionTempFiles(context.config.tempDir, chatId);
      await resetForumTopicNameIfAutoRenamed(context, chatId);
      const isTopic = Boolean(callback.message?.message_thread_id) || String(chatId).includes(":");
      await context.state.resetSession(chatId, true, isTopic);
      await context.telegram.editMessageText(
        chatId,
        messageId,
        sessionInfoHtml(context, chatId),
        { inline_keyboard: [[button(t(lang, "common.backToMenu"), "menu:main")]] },
        "HTML",
      );
      return;
    }
    case "cancel": {
      const result = context.queue.cancelForChat(chatId);
      await context.state.setSession(chatId, { lastMenuMessageId: undefined, activeMenuScreen: undefined, pendingInput: null });
      await context.telegram.editMessageText(
        chatId,
        messageId,
        t(lang, "cancel.callback", {
          removed: result.removed,
          active: result.activeCancelled ? t(lang, "common.yes") : t(lang, "common.no"),
        }),
        { inline_keyboard: [] },
      );
      return;
    }
    case "input-cancel": {
      const session = context.state.session(chatId);
      const pendingKind = session?.pendingInput?.kind;
      const activeScreen = session?.activeMenuScreen;
      await context.state.setSession(chatId, { pendingInput: null });
      if (pendingKind?.startsWith("directive-")) {
        const targetMenu = activeScreen?.startsWith("guide") ? activeScreen : "directives";
        await showMenu(context, chatId, messageId, targetMenu);
        return;
      }
      if (pendingKind?.startsWith("plugin-")) {
        await showMenu(context, chatId, messageId, "plugins");
        return;
      }
      if (pendingKind?.startsWith("mcp-")) {
        await showMenu(context, chatId, messageId, "mcp");
        return;
      }
      if (pendingKind === "git-clone") {
        await showMenu(context, chatId, messageId, "workspace");
        return;
      }
      if (pendingKind === "git-commit") {
        await context.telegram.editMessageText(chatId, messageId, t(lang, "input.cancelled"), backKeyboard(zh));
        return;
      }
      await context.telegram.editMessageText(chatId, messageId, t(lang, "cliopts.title"), cliOptionsKeyboard(context, chatId), "HTML");
      return;
    }
    case "input-clear": {
      const settings = settingsFor(context, chatId);
      if (action.target === "project") settings.project = null;
      else if (action.target === "agent") settings.agent = null;
      else if (action.target === "add-dir") settings.addDirs = [];
      else if (action.target === "json-schema") settings.jsonSchema = null;
      else if (action.target === "log-file") settings.logFile = null;
      else if (action.target === "print-timeout") settings.printTimeout = null;
      await saveSettings(context, chatId, settings);
      await context.state.setSession(chatId, { pendingInput: null });
      await context.telegram.editMessageText(
        chatId,
        messageId,
        t(lang, "input.cleared", { field: action.target }),
        cliOptionsKeyboard(context, chatId),
      );
      return;
    }
    case "remote-start":
    case "remote-stop": {
      const isStart = action.kind === "remote-start";
      const subArgs = isStart ? ["remote-control", "start"] : ["remote-control", "stop"];
      const pendingText = isStart ? t(lang, "rc.starting") : t(lang, "rc.stopping");
      await context.telegram.editMessageText(chatId, messageId, pendingText, { inline_keyboard: [] });
      try {
        await runAgyCommand(context.config.agy, subArgs, 15_000);
      } catch { /* ignore – status page will show real state */ }
      await showMenu(context, chatId, messageId, "remote-control");
      return;
    }
    case "set":
      await applySettingChange(context, chatId, messageId, action.key, action.value);
      return;
  }
}

async function resumeConversation(context: AppContext, chatId: ChatId, messageId: number, convId: string): Promise<void> {
  const lang = resolveLang(settingsFor(context, chatId), context, chatId);
  const zh = lang === "zh";
  if (!isUuid(convId)) {
    await context.telegram.editMessageText(chatId, messageId, t(lang, "resume.invalidUuid"), backKeyboard(zh));
    return;
  }
  const summary = context.convDb.getConversationById(convId);
  if (!summary) {
    await context.telegram.editMessageText(chatId, messageId, t(lang, "resume.notFound"), backKeyboard(zh));
    return;
  }
  const currentSession = context.state.session(chatId) || {};
  const settings = settingsFor(context, chatId);
  settings.continueSession = false;
  await context.state.setSession(chatId, {
    ...currentSession,
    conversationId: summary.conversation_id,
    conversationTitle: summary.display_title,
    conversationStepCount: summary.step_count,
    conversationLastModifiedAt: summary.last_modified_time,
    settings,
    updatedAt: new Date().toISOString(),
  });
  const relativeTime = formatRelativeTime(summary.last_modified_time);
  const msgHtml = t(lang, "resume.switched", {
    title: escapeHtml(summary.display_title),
    steps: summary.step_count,
    time: escapeHtml(relativeTime),
  });
  try {
    await context.telegram.editMessageText(chatId, messageId, msgHtml, { inline_keyboard: [] }, "HTML");
  } catch {
    await context.telegram.editMessageText(chatId, messageId, msgHtml.replace(/<[^>]+>/g, ""), { inline_keyboard: [] }).catch(() => undefined);
  }
}

async function handleCliAction(context: AppContext, chatId: ChatId, messageId: number, command: string): Promise<void> {
  const lang = resolveLang(settingsFor(context, chatId), context, chatId);
  if (command === "check") {
    await context.telegram.editMessageText(chatId, messageId, t(lang, "clicheck.running"));
    try {
      const result = await checkCliCompat(context.config.agy, context.config.stateFile, lang);
      await context.telegram.editMessageText(chatId, messageId, result.report, backKeyboard(lang === "zh"));
    } catch (error) {
      await context.telegram.editMessageText(
        chatId,
        messageId,
        t(lang, "clicheck.failed", { error: (error as Error).message }),
        backKeyboard(lang === "zh"),
      );
    }
    return;
  }
  if (command.startsWith("sub:")) {
    const subcommand = command.slice(4).trim();
    if (subcommand) {
      await runCustomAgy(context, chatId, [subcommand]);
    }
    return;
  }
  if ((CLI_COMMANDS as string[]).includes(command)) await cliOutput(context, chatId, messageId, command as CliCommand);
  else if (command === "update") await runCustomAgy(context, chatId, ["update"]);
  else await showCliOption(context, chatId, messageId, command);
}

async function toggleSetting(context: AppContext, chatId: ChatId, messageId: number, option: string): Promise<void> {
  const settings = settingsFor(context, chatId);
  const lang = resolveLang(settings, context, chatId);
  if (option === "autotopic") {
    settings.autoTopicRename = !settings.autoTopicRename;
    await saveSettings(context, chatId, settings);
    const activeScreen = context.state.session(chatId)?.activeMenuScreen;
    const keyboard = activeScreen === "modesandbox"
      ? modeSandboxKeyboard(context, chatId)
      : cliToolsKeyboard(context, chatId);
    await context.telegram.editMessageText(
      chatId,
      messageId,
      t(lang, "autotopic.toggled", { state: settings.autoTopicRename ? t(lang, "common.on") : t(lang, "common.off") }),
      keyboard,
    );
    return;
  }
  if (option === "continue") settings.continueSession = !settings.continueSession;
  if (option === "new-project") settings.newProject = !settings.newProject;
  if (option === "disable-slash") settings.disableSlashCommands = !settings.disableSlashCommands;
  await saveSettings(context, chatId, settings);
  await context.telegram.editMessageText(chatId, messageId, t(lang, "cliopts.updated"), cliOptionsKeyboard(context, chatId));
}

function isOutputFormat(value: string): value is SettingsOutputFormat {
  return value === "text" || value === "json" || value === "stream-json";
}

async function applySettingChange(context: AppContext, chatId: ChatId, messageId: number, key: string, value: string): Promise<void> {
  const settings = settingsFor(context, chatId);
  const lang = resolveLang(settings, context, chatId);
  if (key === "lang" || key === "language") {
    if (value === "zh" || value === "en") {
      settings.language = value;
      await saveSettings(context, chatId, settings);
      const nextLang = value;
      const zh = value === "zh";
      const idNum = Number(String(chatId).split(":")[0]);
      if (!isNaN(idNum)) {
        const commandSet = zh ? BOT_COMMANDS_ZH : BOT_COMMANDS;
        await context.telegram.setMyCommands(commandSet, { scope: { type: "chat", chat_id: idNum } }).catch(() => undefined);
      }
      await context.telegram.editMessageText(
        chatId,
        messageId,
        t(nextLang, "lang.switched") + t(nextLang, "lang.refreshTip"),
        backKeyboard(zh),
        "HTML",
      );
      await reply(context, chatId, t(nextLang, "lang.kbUpdated"), createMainKeyboard(settings));
      return;
    }
  }
  if (key === "model") {
    const outcome = await selectModel(context, chatId, value);
    if (outcome) {
      await context.telegram.editMessageText(chatId, messageId, outcome.text, outcome.defaultOfferKeyboard, "HTML");
      return;
    }
  }
  if (key === "effort" && isEffort(value)) syncModelForEffort(settings, value);
  if (key === "mode" && isMode(value)) settings.mode = value;
  if (key === "sandbox" && ["on", "off"].includes(value) && (value === "on" || context.config.agy.allowSandboxDisable || !context.config.agy.sandbox)) settings.sandbox = value === "on";
  if (key === "output" && isOutputFormat(value)) settings.outputFormat = value;
  if (key === "verbose" && isVerbose(value)) settings.verbose = value;
  if (key === "ws" || key === "workspace") {
    if (value === "clear" || value === "default" || value === "reset") {
      settings.workspace = null;
      await saveSettings(context, chatId, settings);
      await context.state.resetSession(chatId, true, false);
      await context.telegram.editMessageText(
        chatId,
        messageId,
        t(lang, "ws.reset", { workspace: escapeHtml(context.config.agy.workspace) }),
        { inline_keyboard: [[button(t(lang, "common.backToMenu"), "menu:main")]] },
        "HTML",
      );
      return;
    }
    const resolution = resolveWorkspacePath(value, context.config.agy.projectsRoot, context.config.agy.workspace);
    if (!resolution.valid || !resolution.resolvedPath) {
      await context.telegram.editMessageText(
        chatId,
        messageId,
        t(lang, "ws.error", { error: escapeHtml(resolution.error || "Invalid path.") }),
        { inline_keyboard: [[button(t(lang, "common.back"), "menu:workspace")]] },
        "HTML",
      );
      return;
    }
    settings.workspace = resolution.resolvedPath;
    await saveSettings(context, chatId, settings);
    await context.state.resetSession(chatId, true, true);
    await context.telegram.editMessageText(
      chatId,
      messageId,
      t(lang, "ws.switched", { workspace: escapeHtml(resolution.resolvedPath) }),
      { inline_keyboard: [[button(t(lang, "common.backToMenu"), "menu:main")]] },
      "HTML",
    );
    return;
  }
  if (key === "stt:provider") {
    if (value === "whisper-local" || value === "gemini" || value === "agy" || value === "none") {
      settings.sttProvider = value;
      await saveSettings(context, chatId, settings);
      if (value === "whisper-local") {
        void warmupWhisperLocal(context.config);
      }
      let text = t(lang, "stt.providerSet", { value });
      if (value === "whisper-local" && !isWhisperInstalled(context.config.stt.whisperBin)) {
        text += t(lang, "stt.whisperMissing", { bin: escapeHtml(context.config.stt.whisperBin || "whisper") });
      }
      await context.telegram.editMessageText(chatId, messageId, text, sttKeyboard(context, chatId), "HTML");
      return;
    }
  }
  if (key === "stt:whisper") {
    settings.sttWhisperModel = value;
    await saveSettings(context, chatId, settings);
    await context.telegram.editMessageText(chatId, messageId, t(lang, "stt.whisperSet", { value: escapeHtml(value) }), sttKeyboard(context, chatId), "HTML");
    return;
  }
  if (key === "stt:lang") {
    settings.sttLang = value;
    await saveSettings(context, chatId, settings);
    await context.telegram.editMessageText(chatId, messageId, t(lang, "stt.langSet", { value: escapeHtml(value) }), sttKeyboard(context, chatId), "HTML");
    return;
  }
  if (key === "tts:mode") {
    if (["off", "voice-only", "voice-and-text", "auto"].includes(value)) {
      settings.ttsMode = value as any;
      await saveSettings(context, chatId, settings);
      await context.telegram.editMessageText(chatId, messageId, t(lang, "tts.modeSet", { value }), ttsKeyboard(context, chatId), "HTML");
      return;
    }
  }
  if (key === "profile" && isMenuProfile(value)) {
    settings.menuProfile = value;
    await saveSettings(context, chatId, settings);
    await showMain(context, chatId, messageId);
    return;
  }
  if (key === "tts:voice") {
    settings.ttsVoice = value;
    await saveSettings(context, chatId, settings);
    await context.telegram.editMessageText(chatId, messageId, t(lang, "tts.voiceSet", { value: escapeHtml(value) }), ttsKeyboard(context, chatId), "HTML");
    return;
  }
  await saveSettings(context, chatId, settings);
  if (key === "output") await context.telegram.editMessageText(chatId, messageId, t(lang, "cliopts.outputUpdated", { value }), cliOptionsKeyboard(context, chatId));
  else if (key === "verbose") await context.telegram.editMessageText(chatId, messageId, t(lang, "verbose.set", { value }), verboseKeyboard(context, chatId));
  else await showMain(context, chatId, messageId);
}
