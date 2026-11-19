import fs from "node:fs/promises";
import path from "node:path";
import { JobQueue } from "./queue.js";
import { createMainKeyboard } from "./keyboards.js";
import { escapeHtml } from "./telegram.js";
import type { AppContext, BaseServices } from "./context.js";
import { controllerKey } from "./context.js";
import { refreshCliCapabilities } from "./cli-capabilities.js";
import { settingsFor } from "./domain/settings.js";
import { enqueueJob } from "./usecases/enqueue.js";
import { runPromptJob } from "./usecases/prompt-job.js";
import { defaultSubagentPoller } from "./usecases/subagent-poller.js";
import { restartNoticePath } from "./usecases/self-update.js";
import { handleUpdate } from "./router/updates.js";
import { cleanupStaleTempFiles } from "./usecases/session-cleanup.js";
import type { TelegramUpdate } from "./types.js";

/**
 * Completes the service graph: creates the job queue wired to the prompt use
 * case and the cancellation hook that aborts in-flight AGY processes.
 */
export function createAppServices(base: BaseServices): AppContext {
  const services = { ...base, controllers: new Map<string, AbortController>(), pendingDangerousCommands: new Map<string, string[]>() } as AppContext;
  const queue = new JobQueue(base.config.queue.maxSize, (job, isCancelled) => runPromptJob(services, job, isCancelled), {
    maxConcurrent: 4,
    onCancel: (chatId, includeBtw) => {
      services.controllers.get(controllerKey("prompt", chatId))?.abort();
      services.controllers.get(controllerKey("custom", chatId))?.abort();
      services.controllers.get(controllerKey("subagent_poller", chatId))?.abort();
      if (includeBtw) {
        services.controllers.get(controllerKey("btw", chatId))?.abort();
      }
      defaultSubagentPoller.cancelPolling(chatId);
    },
  });
  services.queue = queue;
  return services;
}

export const BOT_COMMANDS: Array<{ command: string; description: string }> = [
  { command: "menu", description: "Open AGY control panel & live status" },
  { command: "new", description: "Start a new AGY conversation" },
  { command: "model", description: "Switch AI model" },
  { command: "mode", description: "Switch execution mode (plan/edit/auto)" },
  { command: "effort", description: "Set reasoning effort" },
  { command: "workspace", description: "Switch active project workspace" },
  { command: "resume", description: "Resume a saved conversation" },
  { command: "context", description: "Inspect active context & tokens" },
  { command: "usage", description: "Check live models & quota" },
  { command: "compact", description: "Compact context snapshot" },
  { command: "btw", description: "Ask an isolated side question" },
  { command: "cancel", description: "Cancel active or queued jobs" },
  { command: "lang", description: "Switch language / 语言切换" },
  { command: "cli_check", description: "Sync & inspect AGY CLI capabilities" },
  { command: "agy", description: "Run any AGY CLI command" },
  { command: "help", description: "Show control panel & CLI help" },
];

export const BOT_COMMANDS_ZH: Array<{ command: string; description: string }> = [
  { command: "menu", description: "打开控制面板与实时状态" },
  { command: "new", description: "开启新的 AGY 对话" },
  { command: "model", description: "选择或切换 AI 模型" },
  { command: "mode", description: "切换执行模式 (plan/edit/auto)" },
  { command: "effort", description: "设置思考深度" },
  { command: "workspace", description: "切换当前项目工作区" },
  { command: "resume", description: "浏览并恢复历史会话" },
  { command: "context", description: "查看当前活动上下文与 Token" },
  { command: "usage", description: "查询实时模型与配额用量" },
  { command: "compact", description: "压缩上下文以节省 Token" },
  { command: "btw", description: "发起隔离的临时旁支提问" },
  { command: "cancel", description: "终止当前任务与清空队列" },
  { command: "lang", description: "切换界面语言 (中文 / English)" },
  { command: "cli_check", description: "自检并同步 AGY CLI 最新能力" },
  { command: "agy", description: "执行任意原生 AGY CLI 命令" },
  { command: "help", description: "打开面板与 CLI 帮助" },
];

export async function announcePendingRestartNotice(context: AppContext): Promise<void> {
  const noticePath = restartNoticePath(context);
  try {
    const noticeRaw = await fs.readFile(noticePath, "utf8");
    const notice = JSON.parse(noticeRaw) as { chatId: string; reason: string; commit?: string };
    await fs.unlink(noticePath).catch(() => undefined);
    if (notice.chatId) {
      if (notice.reason === "update") {
        await context.telegram.sendMessage(
          notice.chatId,
          `🟢 <b>Bot is back online!</b>\n\nUpdate to <code>${escapeHtml(notice.commit || "latest")}</code> completed successfully.`,
          createMainKeyboard(settingsFor(context, notice.chatId)),
          "HTML"
        ).catch(() => undefined);
      } else {
        await context.telegram.sendMessage(
          notice.chatId,
          `🟢 <b>AGY Gateway online!</b>\n\nService restarted successfully and ready to use.`,
          createMainKeyboard(settingsFor(context, notice.chatId)),
          "HTML"
        ).catch(() => undefined);
      }
    }
  } catch {
    // No pending restart notice
  }
}

export async function resumeInterruptedJobs(context: AppContext): Promise<void> {
  const interrupted = { ...context.state.inFlight };
  if (Object.keys(interrupted).length > 0) {
    await context.state.clearAllInFlight();
    for (const [chatId, job] of Object.entries(interrupted)) {
      if (job.kind === "subagent_poll" && job.conversationId) {
        const remainingMs = 300_000 - (Date.now() - job.startedAt);
        if (remainingMs > 10_000) {
          const settings = settingsFor(context, chatId);
          const effectiveWorkspace = settings.workspace || context.config.agy.workspace;
          await context.telegram.sendMessage(
            chatId,
            `⚡ <b>AGY Gateway restarted</b>\n\nResuming background subagent monitoring...`,
            createMainKeyboard(settingsFor(context, chatId)),
            "HTML"
          ).catch(() => undefined);

          void defaultSubagentPoller.startPolling(context, {
            chatId,
            conversationId: job.conversationId,
            subagentRole: job.subagentRole,
            effectiveWorkspace,
            settings,
            maxDurationMs: remainingMs,
          });
        }
      } else if (job.prompt || job.kind === "usage" || job.kind === "credits" || job.kind === "context" || job.kind === "compact") {
        const promptSnippet = job.prompt ? ` (Prompt: <i>"${escapeHtml(job.prompt.slice(0, 60))}${job.prompt.length > 60 ? "..." : ""}"</i>)` : "";
        const resumeCount = job.resumeCount ?? 0;
        if (resumeCount >= 1) {
          // Already auto-resumed once: do NOT re-run, or a self-restarting
          // agent loops forever (restart -> resume -> restart -> ...).
          await context.telegram.sendMessage(
            chatId,
            `\u269a <b>AGY Gateway restarted</b>\n\n\u4e0a\u4e00\u4e2a\u8bf7\u6c42\u5df2\u88ab\u91cd\u542f\u6253\u65ad\u8fc7\u4e00\u6b21\uff0c\u4e3a\u907f\u514d\u5faa\u73af\u91cd\u542f\uff0c\u8fd9\u6b21\u4e0d\u4f1a\u81ea\u52a8\u91cd\u8dd1\u3002\u8bf7\u91cd\u65b0\u53d1\u9001\uff0c\u6216\u53d1 /new \u5f00\u65b0\u4f1a\u8bdd\u3002`,
            createMainKeyboard(settingsFor(context, chatId)),
            "HTML"
          ).catch(() => undefined);
          continue;
        }
        await context.telegram.sendMessage(
          chatId,
          `⚡ <b>AGY Gateway restarted</b>\n\nYour previous request was interrupted by a restart${promptSnippet}.\n<i>Resuming execution now...</i>`,
          createMainKeyboard(settingsFor(context, chatId)),
          "HTML"
        ).catch(() => undefined);

        enqueueJob(context, chatId, {
          kind: (job.kind as "prompt" | "usage" | "credits" | "context" | "compact") || "prompt",
          prompt: job.prompt,
          resumeCount: resumeCount + 1,
          imagePath: job.imagePath,
          imagePaths: job.imagePaths,
          documentPath: job.documentPath,
          documentPaths: job.documentPaths,
          documentName: job.documentName,
          mediaPath: job.mediaPath,
          mediaPaths: job.mediaPaths,
          mediaType: job.mediaType,
        });
      } else {
        await context.telegram.sendMessage(
          chatId,
          `⚡ <b>AGY Gateway restarted</b>\n\nI am back online and ready for your next command!`,
          createMainKeyboard(settingsFor(context, chatId)),
          "HTML"
        ).catch(() => undefined);
      }
    }
  }
}

/** Handles a batch of updates, guaranteeing the offset advances even when an individual update fails. */
export async function processUpdates(context: AppContext, updates: TelegramUpdate[]): Promise<void> {
  for (const update of updates) {
    try {
      await handleUpdate(context, update);
    } catch (updateErr) {
      console.error("[polling] handleUpdate error:", updateErr);
    } finally {
      await context.state.setOffset(update.update_id + 1);
    }
  }
}

export function createBot(context: AppContext): { start(): Promise<void>; handleUpdate(update: TelegramUpdate): Promise<void> } {
  async function start(): Promise<void> {
    console.log(`agy-telegram started; workspace=${context.config.agy.workspace}; privateOnly=${context.config.telegram.privateOnly}`);
    await cleanupStaleTempFiles(context.config.tempDir).catch((err) => console.error(`cleanupStaleTempFiles failed: ${(err as Error).message}`));
    await refreshCliCapabilities(context.config.agy).catch((error) => console.error(`refreshCliCapabilities failed: ${(error as Error).message}`));
    await context.telegram.setMyCommands(BOT_COMMANDS).catch((error: unknown) => console.error(`setMyCommands default failed: ${(error as Error).message}`));
    await context.telegram.setMyCommands(BOT_COMMANDS_ZH, { language_code: "zh" }).catch((error: unknown) => console.error(`setMyCommands zh failed: ${(error as Error).message}`));

    // Sync chat-specific commands for existing sessions
    for (const [chatId, session] of Object.entries(context.state.allSessions)) {
      if (session.settings?.language === "zh") {
        const idNum = Number(chatId.split(":")[0]);
        if (!isNaN(idNum)) {
          await context.telegram.setMyCommands(BOT_COMMANDS_ZH, { scope: { type: "chat", chat_id: idNum } }).catch(() => undefined);
        }
      }
    }

    // 1. Process pending restart / update notices
    await announcePendingRestartNotice(context);

    // 2. Check for interrupted in-flight jobs
    await resumeInterruptedJobs(context);

    while (true) {
      try {
        const updates = await context.telegram.getUpdates(context.state.offset);
        await processUpdates(context, updates);
      } catch (error) {
        console.error(`[polling] polling error: ${(error as Error).message}`);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }

  return {
    start,
    handleUpdate: (update: TelegramUpdate) => handleUpdate(context, update),
  };
}
