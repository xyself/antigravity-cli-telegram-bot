import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppContext } from "../context.js";
import { resolveLang, t } from "../i18n/index.js";
import { createMainKeyboard } from "../keyboards.js";
import { button, backKeyboard } from "../ui/inline-keyboards.js";
import { modelLabel } from "../models.js";
import { escapeHtml } from "../telegram.js";
import { settingsFor } from "../domain/settings.js";
import { replyWithHtml, reply } from "../ui/reply.js";
import type { ChatId } from "../types.js";

export async function persistDefaultSettings(context: AppContext, chatId: ChatId, messageId?: number): Promise<void> {
  const settings = settingsFor(context, chatId);
  const lang = resolveLang(settings, context, chatId);
  const zh = lang === "zh";
  const envPath = context.config.envFile || path.join(os.homedir(), ".config/agy-telegram/.env");
  try {
    let content = "";
    try {
      content = await fs.readFile(envPath, "utf8");
    } catch {
      // file might not exist yet
    }
    const lines = content.split("\n");
    const newVars: Record<string, string> = {
      AGY_MODEL: settings.model || "",
      AGY_EFFORT: settings.effort || "high",
      AGY_MODE: settings.mode || "accept-edits",
      AGY_SANDBOX: settings.sandbox ? "1" : "0",
      ...(settings.sttProvider ? { STT_PROVIDER: settings.sttProvider } : {}),
      ...(settings.sttWhisperModel ? { STT_WHISPER_MODEL: settings.sttWhisperModel } : {}),
      ...(settings.sttAgyModel ? { STT_AGY_MODEL: settings.sttAgyModel } : {}),
      ...(settings.sttGeminiModel ? { STT_GEMINI_MODEL: settings.sttGeminiModel } : {}),
      ...(settings.sttLang ? { STT_LANGUAGE: settings.sttLang } : {}),
      ...(settings.ttsMode ? { TTS_MODE: settings.ttsMode } : {}),
      ...(settings.ttsVoice ? { TTS_VOICE: settings.ttsVoice } : {}),
      ...(settings.autoTopicRename !== undefined ? { TELEGRAM_AUTO_TOPIC_RENAME: settings.autoTopicRename ? "1" : "0" } : {}),
    };
    const updatedLines = [...lines];
    for (const [key, val] of Object.entries(newVars)) {
      const idx = updatedLines.findIndex((l) => l.startsWith(`${key}=`));
      if (idx >= 0) {
        updatedLines[idx] = `${key}=${val}`;
      } else {
        updatedLines.push(`${key}=${val}`);
      }
    }
    await fs.mkdir(path.dirname(envPath), { recursive: true });
    const tempFile = `${envPath}.tmp.${Date.now()}`;
    await fs.writeFile(tempFile, updatedLines.join("\n"), { encoding: "utf8", mode: 0o600 });
    await fs.rename(tempFile, envPath);

    context.config.agy.model = settings.model || "";
    context.config.agy.effort = settings.effort;
    context.config.agy.mode = settings.mode;
    context.config.agy.sandbox = settings.sandbox;
    if (context.config.stt) {
      if (settings.sttProvider) context.config.stt.provider = settings.sttProvider;
      if (settings.sttWhisperModel) context.config.stt.whisperModel = settings.sttWhisperModel;
      if (settings.sttAgyModel) context.config.stt.agyModel = settings.sttAgyModel;
      if (settings.sttGeminiModel) context.config.stt.geminiModel = settings.sttGeminiModel;
      if (settings.sttLang) context.config.stt.language = settings.sttLang;
    }
    if (context.config.tts) {
      if (settings.ttsMode) context.config.tts.mode = settings.ttsMode;
      if (settings.ttsVoice) context.config.tts.voice = settings.ttsVoice;
    }
    if (settings.autoTopicRename !== undefined) {
      context.config.telegram.autoTopicRename = settings.autoTopicRename;
    }

    const extraParts: string[] = [];
    if (settings.ttsMode) extraParts.push(`\n• <b>TTS:</b> ${escapeHtml(settings.ttsMode)} (${escapeHtml(settings.ttsVoice || "default")})`);
    if (settings.sttProvider) extraParts.push(`\n• <b>STT:</b> ${escapeHtml(settings.sttProvider)} (${escapeHtml(settings.sttLang || "auto")})`);
    if (settings.autoTopicRename !== undefined) {
      extraParts.push(`\n• <b>${t(lang, "session.autoTopic")}:</b> ${settings.autoTopicRename ? t(lang, "common.on") : t(lang, "common.off")}`);
    }
    const text = t(lang, "defaults.saved", {
      model: escapeHtml(modelLabel(settings.model)),
      effort: escapeHtml(settings.effort),
      mode: escapeHtml(settings.mode === "accept-edits" ? "edit" : settings.mode),
      sandbox: settings.sandbox ? t(lang, "common.on") : t(lang, "common.off"),
      extra: extraParts.join(""),
    });
    if (messageId) {
      await context.telegram.editMessageText(chatId, messageId, text, { inline_keyboard: [[button(t(lang, "common.backToMenu"), "menu:main")]] }, "HTML");
    } else {
      await replyWithHtml(context, chatId, text, createMainKeyboard(settings));
    }
  } catch (error) {
    const errorText = t(lang, "defaults.failed", { error: (error as Error).message });
    if (messageId) {
      await context.telegram.editMessageText(chatId, messageId, errorText, backKeyboard(zh));
    } else {
      await reply(context, chatId, errorText, createMainKeyboard(settings));
    }
  }
}
