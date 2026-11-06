import { isSessionBusy, type AppContext } from "../context.js";
import { isZh, settingsFor } from "../domain/settings.js";
import { createMainKeyboard } from "../keyboards.js";
import { escapeHtml } from "../telegram.js";
import type { ChatId } from "../types.js";
import { replyWithHtml } from "../ui/reply.js";
import { refreshActiveMenu } from "../ui/screens.js";

/**
 * Clones the active AGY conversation into a new independent branch in SQLite
 * and switches the chat's active session to the newly created fork.
 */
export async function handleForkCommand(
  context: AppContext,
  chatId: ChatId,
  rawCustomTitle: string
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

  const session = context.state.session(chatId);
  const sourceId = session?.conversationId;

  if (!sourceId) {
    await replyWithHtml(
      context,
      chatId,
      zh
        ? "⚠️ <b>没有可分叉克隆的活跃会话。</b>\n\n请先发送消息开启对话或使用 <code>/resume</code> 恢复已有会话。"
        : "⚠️ <b>No active conversation to fork.</b>\n\nStart a conversation or resume one with <code>/resume</code> first.",
      createMainKeyboard(settings)
    );
    return;
  }

  const effectiveWorkspace = settings.workspace || context.config.agy.workspace;
  const customTitle = rawCustomTitle.trim() || undefined;
  const forked = context.convDb.forkConversation(sourceId, customTitle, {
    title: session?.conversationTitle || "Conversation",
    stepCount: session?.conversationStepCount || 1,
    workspace: effectiveWorkspace,
    projectId: settings.project || "default-cli-project",
  });

  if (!forked) {
    await replyWithHtml(
      context,
      chatId,
      zh
        ? "⚠️ <b>克隆分叉活跃会话失败。</b>\n\n请确认会话数据库正常并稍后重试。"
        : "⚠️ <b>Failed to fork the active conversation.</b>\n\nVerify that the conversation database is accessible and try again.",
      createMainKeyboard(settings)
    );
    return;
  }

  await context.state.setSession(chatId, {
    ...(session || {}),
    conversationId: forked.conversationId,
    conversationTitle: forked.title,
    conversationStepCount: forked.stepCount,
    conversationLastModifiedAt: Date.now(),
    updatedAt: new Date().toISOString(),
  });

  await refreshActiveMenu(context, chatId);

  const lines = zh
    ? [
        "🔀 <b>会话已成功分叉克隆</b>\n",
        `• <b>新分支:</b> <b>${escapeHtml(forked.title)}</b> (<code>${escapeHtml(forked.conversationId.slice(0, 8))}…</code>)`,
        `• <b>父会话:</b> <code>${escapeHtml(forked.parentConversationId.slice(0, 8))}…</code> (已继承 ${forked.stepCount} 轮对话)\n`,
        "后续提问将在此新分支上继续进行。您可随时通过 <code>/resume</code> 切换回原会话。",
      ]
    : [
        "🔀 <b>Conversation forked</b>\n",
        `• <b>New branch:</b> <b>${escapeHtml(forked.title)}</b> (<code>${escapeHtml(forked.conversationId.slice(0, 8))}…</code>)`,
        `• <b>Parent session:</b> <code>${escapeHtml(forked.parentConversationId.slice(0, 8))}…</code> (${forked.stepCount} step${forked.stepCount === 1 ? "" : "s"} preserved)\n`,
        "Future prompts will continue on this new branch. Use <code>/resume</code> anytime to switch back to the original session.",
      ];

  await replyWithHtml(context, chatId, lines.join("\n"), createMainKeyboard(settings));
}
