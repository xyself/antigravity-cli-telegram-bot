import type { ReplyKeyboardMarkup, SessionSettings } from "./types.js";
import { isZh } from "./domain/settings.js";

/** Persistent keyboard shown immediately above Telegram's input field. */
export function createMainKeyboard(settings?: SessionSettings): ReplyKeyboardMarkup {
  const zh = isZh(settings);
  return {
    keyboard: [
      zh
        ? ["✨ 新对话", "🛑 停止", "🤖 模型", "💬 临时对话", "📋 菜单"]
        : ["✨ New", "🛑 Stop", "🤖 Model", "💬 Btw", "📋 Menu"],
      zh
        ? ["📁 Diff", "⏪ 回退", "🗜️ 压缩", "📊 额度", "🌿 分支"]
        : ["📁 Diff", "⏪ Rewind", "🗜️ Compact", "📊 Quota", "🌿 Fork"],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: zh ? "向 AGY 发送提示词..." : "Send a prompt to AGY...",
  };
}
