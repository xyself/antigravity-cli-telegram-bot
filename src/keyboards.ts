import type { ReplyKeyboardMarkup, SessionSettings } from "./types.js";
import { resolveLang, t } from "./i18n/index.js";

/** Persistent keyboard shown immediately above Telegram's input field. */
export function createMainKeyboard(settings?: SessionSettings): ReplyKeyboardMarkup {
  const lang = resolveLang(settings);
  return {
    keyboard: [
      [t(lang, "kb.new"), t(lang, "kb.stop"), t(lang, "kb.model"), t(lang, "kb.btw"), t(lang, "kb.menu")],
      [t(lang, "kb.diff"), t(lang, "kb.rewind"), t(lang, "kb.compact"), t(lang, "kb.quota"), t(lang, "kb.fork")],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: t(lang, "kb.placeholder"),
  };
}
