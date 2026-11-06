import { isSessionBusy, type AppContext } from "../context.js";
import { isZh, settingsFor } from "../domain/settings.js";
import { createMainKeyboard } from "../keyboards.js";
import { escapeHtml } from "../telegram.js";
import type { ChatId } from "../types.js";
import { replyWithHtml } from "../ui/reply.js";
import { refreshActiveMenu } from "../ui/screens.js";

/**
 * Rolls back the active AGY conversation by N user turns (default: 1) in the
 * SQLite store and JSONL transcripts, updating the active session state.
 */
export async function handleRewindCommand(
  context: AppContext,
  chatId: ChatId,
  rawArg: string
): Promise<void> {
  const settings = settingsFor(context, chatId);
  const zh = isZh(settings, context, chatId);

  if (isSessionBusy(context, chatId)) {
    await replyWithHtml(
      context,
      chatId,
      zh
        ? "⚠️ <b>当前会话正忙。</b>\n\n请等待当前回复完成，或先发送 <code>/stop</code> 终止。"
        : "⚠️ <b>Session is currently busy.</b>\n\nPlease wait for the current turn to finish or use <code>/stop</code> first.",
      createMainKeyboard(settings)
    );
    return;
  }

  const trimmed = rawArg.trim();

  let turns = 1;
  if (trimmed.length > 0) {
    if (!/^\d+$/.test(trimmed)) {
      await replyWithHtml(
        context,
        chatId,
        zh
          ? "用法: <code>/rewind [轮数]</code> 或 <code>/undo [轮数]</code>\n\n示例: <code>/rewind</code> (回滚 1 轮) 或 <code>/rewind 2</code>。"
          : "Usage: <code>/rewind [turns]</code> or <code>/undo [turns]</code>\n\nExample: <code>/rewind</code> (roll back 1 turn) or <code>/rewind 2</code>.",
        createMainKeyboard(settings)
      );
      return;
    }
    turns = Number(trimmed);
    if (!Number.isSafeInteger(turns) || turns < 1 || turns > 50) {
      await replyWithHtml(
        context,
        chatId,
        zh
          ? "⚠️ 请指定 1 到 50 之间的有效回滚轮数 (例如 <code>/rewind 1</code>)。"
          : "⚠️ Please specify a valid number of turns between 1 and 50 (e.g. <code>/rewind 1</code>).",
        createMainKeyboard(settings)
      );
      return;
    }
  }

  const session = context.state.session(chatId);
  const conversationId = session?.conversationId;
  if (!conversationId) {
    await replyWithHtml(
      context,
      chatId,
      zh
        ? "⚠️ <b>没有可回滚的活跃会话。</b>\n\n请先发送消息开启对话或使用 <code>/resume</code> 恢复已有会话。"
        : "⚠️ <b>No active conversation to rewind.</b>\n\nStart a conversation or resume one with <code>/resume</code> first.",
      createMainKeyboard(settings)
    );
    return;
  }

  const result = context.convDb.rewindConversation(conversationId, turns);
  if (!result.ok) {
    if (result.reason === "cannot_rewind_initial_turn") {
      const available = result.totalTurns && result.totalTurns > 1
        ? (zh ? `保留初始提示词的前提下，当前最多仅能回退 ${result.totalTurns - 1} 轮。` : `Only ${result.totalTurns - 1} turn(s) can be rewound while keeping the initial prompt.`)
        : (zh ? "无法回滚超过会话的初始轮次。" : "Cannot rewind past the initial turn of the conversation.");
      await replyWithHtml(
        context,
        chatId,
        zh
          ? `⚠️ <b>无法回退 ${turns} 轮对话。</b>\n\n${escapeHtml(available)} 如果想开启全新对话，请使用 <code>/new</code>。`
          : `⚠️ <b>Cannot rewind ${turns} turn${turns === 1 ? "" : "s"}.</b>\n\n${escapeHtml(available)} Use <code>/new</code> if you want to start a fresh session.`,
        createMainKeyboard(settings)
      );
      return;
    }

    if (result.reason === "unrecognized_schema") {
      await replyWithHtml(
        context,
        chatId,
        zh
          ? "⚠️ <b>无法回滚此会话。</b>\n\n会话数据库使用了无法识别或不兼容的表结构，已保持历史数据不变。"
          : "⚠️ <b>Cannot rewind this conversation.</b>\n\nThe conversation database uses an unrecognized or incompatible schema. History was left untouched.",
        createMainKeyboard(settings)
      );
      return;
    }

    await replyWithHtml(
      context,
      chatId,
      zh
        ? "⚠️ <b>无法回滚当前活跃会话。</b>\n\n在本地数据库中未找到该会话的历史记录。"
        : "⚠️ <b>Could not rewind the active conversation.</b>\n\nThe conversation history could not be found in the local store.",
      createMainKeyboard(settings)
    );
    return;
  }

  const remainingSteps = result.remainingSteps ?? Math.max(1, (session?.conversationStepCount || 1) - (result.removedSteps || turns));

  await context.state.setSession(chatId, {
    ...(session || {}),
    conversationStepCount: remainingSteps,
    contextTokens: undefined,
    contextPercentage: undefined,
    conversationLastModifiedAt: Date.now(),
    updatedAt: new Date().toISOString(),
  });

  await refreshActiveMenu(context, chatId);

  const lines = zh
    ? [
        "⏪ <b>会话已成功回滚</b>\n",
        `• <b>已回滚:</b> ${result.removedTurns} 轮对话 (移除了 ${result.removedSteps} 个执行步骤)`,
        `• <b>剩余历史:</b> ${remainingSteps} 个步骤`,
      ]
    : [
        "⏪ <b>Conversation rewound</b>\n",
        `• <b>Rolled back:</b> ${result.removedTurns} turn${result.removedTurns === 1 ? "" : "s"} (${result.removedSteps} step${result.removedSteps === 1 ? "" : "s"} removed)`,
        `• <b>Remaining history:</b> ${remainingSteps} step${remainingSteps === 1 ? "" : "s"}`,
      ];
  if (result.rewoundPromptPreview) {
    lines.push(zh ? `• <b>回滚掉的提问:</b> <i>"${escapeHtml(result.rewoundPromptPreview)}"</i>` : `• <b>Rewound prompt:</b> <i>"${escapeHtml(result.rewoundPromptPreview)}"</i>`);
  }
  lines.push(zh ? "\n后续提问将从回滚后的检查点继续进行。" : "\nFuture prompts will continue from this earlier checkpoint.");

  await replyWithHtml(context, chatId, lines.join("\n"), createMainKeyboard(settings));
}
