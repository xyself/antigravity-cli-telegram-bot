import { parseAgyModelsOutput, setActiveModels, modelLabel, resolveModelWithEffort } from "../models.js";
import { runAgyCommand } from "../agy-runner.js";
import type { AppContext } from "../context.js";
import { isEffort } from "../config.js";
import { resolveLang, t } from "../i18n/index.js";
import { escapeHtml } from "../telegram.js";
import { isModelAllowed, saveSettings, settingsFor } from "../domain/settings.js";
import { button } from "../ui/inline-keyboards.js";
import type { ChatId, InlineKeyboardMarkup, SessionSettings } from "../types.js";

export async function refreshModels(context: AppContext): Promise<void> {
  try {
    const output = await runAgyCommand(context.config.agy, ["models"], 15_000);
    const parsed = parseAgyModelsOutput(output);
    if (parsed.length > 0) {
      setActiveModels(parsed);
    }
  } catch {
    // Keep fallback models if agy models is unavailable
  }
}

export interface ModelSelectionOutcome {
  settings: SessionSettings;
  text: string;
  defaultOfferKeyboard: InlineKeyboardMarkup;
}

export async function selectModel(context: AppContext, chatId: ChatId, modelId: string): Promise<ModelSelectionOutcome | null> {
  if (!isModelAllowed(context, modelId)) return null;
  const settings = settingsFor(context, chatId);
  const lang = resolveLang(settings, context, chatId);
  const explicitSuffix = /-(low|medium|high|xhigh|max|ultra)$/i.exec(modelId);
  const resolved = resolveModelWithEffort(
    modelId,
    explicitSuffix ? explicitSuffix[1].toLowerCase() : settings.effort,
  );
  settings.model = resolved.modelId;
  if (resolved.effort && isEffort(resolved.effort)) {
    settings.effort = resolved.effort;
  }
  await saveSettings(context, chatId, settings);
  const text = t(lang, "model.set", { label: escapeHtml(modelLabel(settings.model)) });
  const defaultOfferKeyboard: InlineKeyboardMarkup = {
    inline_keyboard: [
      [button(t(lang, "model.saveDefaultBtn"), "action:setdefault"), button(t(lang, "model.onlySessionBtn"), "menu:main")],
    ],
  };
  return { settings, text, defaultOfferKeyboard };
}

/**
 * Updates `settings.effort` and automatically switches `settings.model` to the matching
 * variant in the same model family (e.g. `gemini-4-hydrogen-high` -> `gemini-4-hydrogen-xhigh`),
 * mirroring AGY CLI's native `/effort` gauge behavior.
 */
export function syncModelForEffort(settings: SessionSettings, nextEffort: string): void {
  settings.effort = nextEffort;
  if (settings.model) {
    const resolved = resolveModelWithEffort(settings.model, nextEffort);
    if (resolved.modelId) {
      settings.model = resolved.modelId;
    }
  }
}
