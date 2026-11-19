import type { AppContext } from "../context.js";
import { isZh } from "../domain/settings.js";
import type { ChatId, SessionSettings } from "../types.js";
import { en } from "./en.js";
import { zh } from "./zh.js";

export type Lang = "en" | "zh";
export type I18nKey = keyof typeof en;

const DICTIONARIES: Record<Lang, Record<I18nKey, string>> = { en, zh };

export function resolveLang(
  settings?: Partial<SessionSettings> | null,
  context?: AppContext,
  chatId?: ChatId,
): Lang {
  return isZh(settings as SessionSettings | null | undefined, context, chatId) ? "zh" : "en";
}

export function t(
  lang: Lang,
  key: I18nKey,
  vars?: Record<string, string | number | undefined>,
): string {
  const dict = DICTIONARIES[lang] ?? en;
  let text = dict[key] ?? en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, v === undefined ? "" : String(v));
    }
  }
  return text;
}
