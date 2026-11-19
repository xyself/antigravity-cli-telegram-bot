import { formatRelativeTime, type ConversationPage } from "../db.js";
import type { AppContext } from "../context.js";
import { getCliVersion } from "../cli-capabilities.js";
import { resolveLang, t } from "../i18n/index.js";
import { getModelMaxContext, modelLabel, renderContextProgressBar } from "../models.js";
import { escapeHtml } from "../telegram.js";
import { settingsFor } from "../domain/settings.js";
import { resolveEffectiveForumThreadId } from "../domain/topic-namer.js";
import type { ChatId, SessionSettings, Usage } from "../types.js";

export function settingsText(settings: SessionSettings): string {
  return [
    `Model: ${modelLabel(settings.model)}`, `Effort: ${settings.effort}`, `Mode: ${settings.mode}`,
    `Verbose: ${settings.verbose || "detailed"}`, `Agent: ${settings.agent || "default"}`, `Project: ${settings.project || "default"}`,
    `Sandbox: ${settings.sandbox ? "enabled" : "disabled"}`, `Output: ${settings.outputFormat}`,
    settings.workspace ? `Workspace: ${settings.workspace}` : null,
    `Add dirs: ${settings.addDirs?.length || 0}`, `Slash commands: ${settings.disableSlashCommands ? "disabled" : "enabled"}`,
    `Auto topic rename: ${settings.autoTopicRename ? "enabled" : "disabled"}`,
  ].filter(Boolean).join("\n");
}

/** Live status dashboard rendered at the top of `/menu` & `/start`. */
export function controlPanelHtml(context: AppContext, chatId: ChatId): string {
  const settings = settingsFor(context, chatId);
  const lang = resolveLang(settings, context, chatId);
  const session = context.state.session(chatId);
  const queueStatus = context.queue?.statusForChat(chatId);

  const wsPath = settings.workspace || context.config.agy.workspace;
  const wsLabel = settings.workspace ? `${wsPath} (${lang === "zh" ? "自定义" : "custom"})` : wsPath;

  const sessionTitle = session?.conversationTitle
    ? session.conversationTitle.slice(0, 32) + (session.conversationTitle.length > 32 ? "…" : "")
    : (session?.conversationId ? session.conversationId.slice(0, 8) : t(lang, "panel.newSession"));

  const contextValue = session?.contextTokens
    ? `${session.contextTokens}${session.contextPercentage !== undefined ? ` (${session.contextPercentage}%)` : ""}`
    : `${getModelMaxContext(settings.model).toLocaleString()} max`;

  const stt = settings.sttProvider || context.config.stt?.provider || "none";
  const tts = settings.ttsMode || context.config.tts?.mode || "off";
  const cliVersion = getCliVersion();
  const stateLabel = queueStatus?.active
    ? `${t(lang, "panel.running")}${queueStatus.queued ? ` (+${queueStatus.queued})` : ""}`
    : t(lang, "panel.idle");

  const lines = [
    t(lang, "panel.title"),
    "",
    `• <b>${t(lang, "panel.model")}:</b> <code>${escapeHtml(modelLabel(settings.model))}</code> · <code>${escapeHtml(settings.effort || "high")}</code>`,
    `• <b>${t(lang, "panel.mode")}:</b> <code>${escapeHtml(settings.mode || "plan")}</code> · <b>${t(lang, "panel.sandbox")}:</b> <code>${settings.sandbox ? t(lang, "common.on") : t(lang, "common.off")}</code>`,
    `• <b>${t(lang, "panel.workspace")}:</b> <code>${escapeHtml(wsLabel)}</code>`,
    `• <b>${t(lang, "panel.session")}:</b> <code>${escapeHtml(sessionTitle)}</code> · <b>${t(lang, "panel.context")}:</b> <code>${escapeHtml(contextValue)}</code>`,
    `• <b>${t(lang, "panel.voice")}:</b> <code>STT:${escapeHtml(stt)} / TTS:${escapeHtml(tts)}</code> · <b>${t(lang, "panel.status")}:</b> <code>${escapeHtml(stateLabel)}</code>`,
  ];

  if (cliVersion) {
    lines.push(`• <b>${t(lang, "panel.cli")}:</b> <code>${escapeHtml(cliVersion)}</code>`);
  }

  return lines.join("\n");
}

export function sessionInfoHtml(context: AppContext, chatId: ChatId): string {
  const settings = settingsFor(context, chatId);
  const lang = resolveLang(settings, context, chatId);
  const zh = lang === "zh";
  const maxContext = getModelMaxContext(settings.model);
  const contextStr = maxContext ? `${maxContext.toLocaleString()} tokens` : t(lang, "common.default");
  const modeStr = settings.mode === "accept-edits" ? (zh ? "编辑模式 (accept-edits)" : "edit (accept-edits)") : (settings.mode || "plan");
  const { threadId } = resolveEffectiveForumThreadId(chatId, context.config.telegram?.enableTopics);
  const showAutoTopic = threadId !== undefined || Boolean(settings.autoTopicRename);

  if (zh) {
    return [
      `${t(lang, "session.newStarted")}\n`,
      `• <b>${t(lang, "panel.model")}:</b> <code>${escapeHtml(modelLabel(settings.model))}</code>`,
      `• <b>${t(lang, "panel.effort")}:</b> <code>${escapeHtml(settings.effort || "high")}</code>`,
      `• <b>${t(lang, "panel.mode")}:</b> <code>${escapeHtml(modeStr)}</code>`,
      `• <b>${t(lang, "panel.verbose")}:</b> <code>${escapeHtml(settings.verbose || "detailed")}</code>`,
      `• <b>${t(lang, "session.contextLimit")}:</b> <code>${escapeHtml(contextStr)}</code>`,
      `• <b>${t(lang, "panel.sandbox")}:</b> <code>${settings.sandbox ? t(lang, "common.enabledCap") : t(lang, "common.disabledCap")}</code>`,
      showAutoTopic ? `• <b>${t(lang, "session.autoTopic")}:</b> <code>${settings.autoTopicRename ? t(lang, "common.enabledCap") : t(lang, "common.disabledCap")}</code>` : null,
      settings.workspace ? `• <b>${t(lang, "panel.workspace")}:</b> <code>${escapeHtml(settings.workspace)}</code>` : null,
      context.config.agy.project ? `• <b>${t(lang, "session.project")}:</b> <code>${escapeHtml(context.config.agy.project)}</code>` : null,
    ].filter(Boolean).join("\n");
  }

  return [
    `${t(lang, "session.newStarted")}\n`,
    `• <b>${t(lang, "panel.model")}:</b> <code>${escapeHtml(modelLabel(settings.model))}</code>`,
    `• <b>${t(lang, "panel.effort")}:</b> <code>${escapeHtml(settings.effort || "high")}</code>`,
    `• <b>${t(lang, "panel.mode")}:</b> <code>${escapeHtml(modeStr)}</code>`,
    `• <b>${t(lang, "panel.verbose")}:</b> <code>${escapeHtml(settings.verbose || "detailed")}</code>`,
    `• <b>${t(lang, "session.contextLimit")}:</b> <code>${escapeHtml(contextStr)}</code>`,
    `• <b>${t(lang, "panel.sandbox")}:</b> <code>${settings.sandbox ? t(lang, "common.enabledCap") : t(lang, "common.disabledCap")}</code>`,
    showAutoTopic ? `• <b>${t(lang, "session.autoTopic")}:</b> <code>${settings.autoTopicRename ? t(lang, "common.enabledCap") : t(lang, "common.disabledCap")}</code>` : null,
    settings.workspace ? `• <b>${t(lang, "panel.workspace")}:</b> <code>${escapeHtml(settings.workspace)}</code>` : null,
    context.config.agy.project ? `• <b>${t(lang, "session.project")}:</b> <code>${escapeHtml(context.config.agy.project)}</code>` : null,
  ].filter(Boolean).join("\n");
}

export function usageText(usage: Usage | null | undefined, modelId: string | null = null, isAccumulated = false): string {
  if (!usage) return "Usage data was not provided by AGY.";
  const activeInputContext = (usage.input_tokens || 0) + (usage.cache_read_tokens || 0);
  const maxContext = getModelMaxContext(modelId);
  const lines: string[] = [];
  if (!isAccumulated && activeInputContext > 0) {
    if (activeInputContext <= maxContext) {
      lines.push(`Active Context: ${renderContextProgressBar(activeInputContext, maxContext)}`);
    } else {
      lines.push(`Context reported by AGY: ${activeInputContext.toLocaleString()} tokens (Session Total; active context unavailable)`);
    }
  }
  const labels: Array<[keyof Usage, string]> = [["input_tokens", "Input (New)"], ["output_tokens", "Output"], ["thinking_tokens", "Thinking"], ["cache_read_tokens", "Cache-read"], ["total_tokens", "Total Billed"]];
  for (const [key, label] of labels) {
    if (usage[key] !== undefined) {
      lines.push(`${label}: ${usage[key]!.toLocaleString()}`);
    }
  }
  return lines.join("\n") || "Usage data was not provided by AGY.";
}

export function sessionText(context: AppContext, chatId: ChatId): string {
  const session = context.state.session(chatId);
  const status = context.queue.statusForChat(chatId);
  const title = session?.conversationTitle || (session?.conversationId ? "Untitled session" : "new");
  const lines = [
    "Session\n",
    `Active: ${title}`,
    `Conversation: ${session?.conversationId || "new"}`,
  ];
  if (session?.conversationStepCount) {
    const relative = formatRelativeTime(session.conversationLastModifiedAt || session.updatedAt);
    lines.push(`Steps: ${session.conversationStepCount} · Last active: ${relative}`);
  }
  const customWs = settingsFor(context, chatId).workspace;
  lines.push(`Workspace: ${customWs || context.config.agy.workspace}${customWs ? " (custom)" : " (default)"}`);
  lines.push(settingsText(settingsFor(context, chatId)));
  lines.push(`Status: ${status.active ? "running" : "idle"}`);
  return lines.join("\n");
}

export function resumeMessageText(pageData: ConversationPage, zh = false): string {
  const lang = zh ? "zh" : "en";
  if (pageData.total === 0 || pageData.items.length === 0) {
    return t(lang, "resume.empty");
  }
  return t(lang, "resume.header", {
    page: pageData.page + 1,
    totalPages: pageData.totalPages,
    total: pageData.total,
  });
}

export function usageReport(context: AppContext, chatId: ChatId): string {
  const session = context.state.session(chatId);
  const last = session?.lastRun;
  const modelId = last?.model || settingsFor(context, chatId).model;
  const lastText = last ? [`Last run: ${last.status}`, last.model ? `Model: ${modelLabel(last.model)}` : null, last.durationMs ? `Duration: ${(last.durationMs / 1000).toFixed(1)}s` : null, last.numTurns !== null ? `Turns: ${last.numTurns}` : null, last.toolCalls ? `Tool calls: ${last.toolCalls}` : null, usageText(last.usage, modelId)].filter(Boolean).join("\n") : "Last run: no completed run yet.";
  return `Usage / Quota\n\n${lastText}\n\nAccumulated usage:\n${usageText(session?.usageTotals, modelId, true)}\n\nSubscription quota is not exposed by AGY stream-json.`;
}

export function sessionOptionUsage(option: string): string {
  return [
    `/project ID|clear`, `/add-dir PATH|clear`, `/output-format text|json|stream-json`,
    `/json-schema JSON_OR_PATH|clear`, `/log-file PATH|clear`, `/print-timeout DURATION|clear`,
    `/continue on|off`, `/new-project on|off`, `/disable-slash-commands on|off`,
  ].find((line) => line.startsWith(`/${option} `)) || `Usage: /${option} VALUE`;
}
