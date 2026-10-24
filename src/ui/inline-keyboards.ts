import type { AppContext } from "../context.js";
import { getActiveModels } from "../models.js";
import { formatRelativeTime } from "../db.js";
import { isZh, settingsFor } from "../domain/settings.js";
import { listAvailableWorkspaces } from "../domain/workspace.js";
import type { ChatId, InlineKeyboardMarkup, InlineButton, ConversationSummary, SessionState } from "../types.js";

export function button(text: string, callback_data: string): { text: string; callback_data: string } { return { text, callback_data }; }

export function backKeyboard(zh = false): InlineKeyboardMarkup {
  return { inline_keyboard: [[button(zh ? "‹ 返回" : "‹ Back", "menu:main")]] };
}

export function contextActionsKeyboard(zh = false): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [button(zh ? "🗜️ 压缩上下文" : "🗜️ Compact Context", "action:compact"), button(zh ? "🔄 刷新" : "🔄 Refresh", "action:context")],
    ],
  };
}

export function contextButtonLabel(session?: SessionState | null, zh = false): string {
  if (session?.contextTokens) {
    const pct = session.contextPercentage !== undefined ? ` (${session.contextPercentage}%)` : "";
    return `🧠 ${session.contextTokens}${pct}`;
  }
  return zh ? "🧠 活动上下文" : "🧠 Active Context";
}

export function resumeKeyboard(page = 0, totalPages = 1, items: ConversationSummary[] = [], zh = false): InlineKeyboardMarkup {
  const rows: InlineButton[][] = items.map((item) => {
    const time = formatRelativeTime(item.last_modified_time);
    const suffix = ` (${time})`;
    const maxTitleLen = Math.max(12, 38 - suffix.length);
    const title = item.display_title.length > maxTitleLen
      ? `${item.display_title.slice(0, maxTitleLen - 1)}…`
      : item.display_title;
    return [
      button(
        `💬 ${title}${suffix}`,
        `resume:use:${item.conversation_id}`
      ),
    ];
  });
  const navigation: InlineButton[] = [];
  if (page > 0) navigation.push(button(zh ? "‹ 上一页" : "‹ Previous", `resume:page:${page - 1}`));
  navigation.push(button(`${page + 1}/${totalPages}`, "noop"));
  if (page < totalPages - 1) navigation.push(button(zh ? "下一页 ›" : "Next ›", `resume:page:${page + 1}`));
  if (navigation.length) rows.push(navigation);
  rows.push([button(zh ? "‹ 返回" : "‹ Back", "menu:main")]);
  return { inline_keyboard: rows };
}

export function modelKeyboard(context: AppContext, chatId: ChatId, page = 0): InlineKeyboardMarkup {
  const zh = isZh(settingsFor(context, chatId), context, chatId);
  const pageSize = 5;
  const models = getActiveModels();
  const totalPages = Math.max(1, Math.ceil(models.length / pageSize));
  const normalizedPage = Math.min(Math.max(page, 0), totalPages - 1);
  const selected = settingsFor(context, chatId).model;
  const rows = models.slice(normalizedPage * pageSize, normalizedPage * pageSize + pageSize).map((model) => [button(`${model.id === selected ? "✅ " : ""}${model.label}`, `set:model:${model.id}`)]);
  const navigation = [];
  if (normalizedPage > 0) navigation.push(button("‹", `menu:models:${normalizedPage - 1}`));
  navigation.push(button(`${normalizedPage + 1}/${totalPages}`, "noop"));
  if (normalizedPage < totalPages - 1) navigation.push(button("›", `menu:models:${normalizedPage + 1}`));
  rows.push(navigation);
  rows.push([button(zh ? "‹ 返回" : "‹ Back", "menu:main")]);
  return { inline_keyboard: rows };
}

export function effortKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const zh = isZh(settingsFor(context, chatId), context, chatId);
  const selected = settingsFor(context, chatId).effort;
  const choices = ["low", "medium", "high"].map((value) => {
    const label = zh ? (value === "low" ? "低 (low)" : value === "medium" ? "中 (medium)" : "高 (high)") : value;
    return button(`${value === selected ? "✅ " : ""}${label}`, `set:effort:${value}`);
  });
  return { inline_keyboard: [choices, [button(zh ? "‹ 返回" : "‹ Back", "menu:main")]] };
}

export function modeKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const zh = isZh(settingsFor(context, chatId), context, chatId);
  const selected = settingsFor(context, chatId).mode;
  const choices = ["plan", "accept-edits"].map((value) => {
    const label = zh ? (value === "plan" ? "规划 (plan)" : "接受编辑 (accept-edits)") : value;
    return button(`${value === selected ? "✅ " : ""}${label}`, `set:mode:${value}`);
  });
  return { inline_keyboard: [choices, [button(zh ? "‹ 返回" : "‹ Back", "menu:main")]] };
}

export function sandboxKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const zh = isZh(settingsFor(context, chatId), context, chatId);
  const selected = settingsFor(context, chatId).sandbox;
  const disableAllowed = context.config.agy.allowSandboxDisable || !context.config.agy.sandbox;
  const onLabel = zh ? "开启" : "On";
  const offLabel = zh ? "关闭" : "Off";
  const lockedLabel = zh ? " (锁定)" : " (locked)";
  return { inline_keyboard: [[button(`${selected ? "✅ " : ""}${onLabel}`, "set:sandbox:on"), button(`${!selected ? "✅ " : ""}${offLabel}${disableAllowed ? "" : lockedLabel}`, disableAllowed ? "set:sandbox:off" : "noop")], [button(zh ? "‹ 返回" : "‹ Back", "menu:main")]] };
}

export function verboseKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const zh = isZh(settingsFor(context, chatId), context, chatId);
  const selected = settingsFor(context, chatId).verbose || "detailed";
  const choices = ["detailed", "compact", "silent"].map((value) => {
    const label = zh ? (value === "detailed" ? "详细 (detailed)" : value === "compact" ? "紧凑 (compact)" : "静默 (silent)") : value;
    return button(`${value === selected ? "✅ " : ""}${label}`, `set:verbose:${value}`);
  });
  return { inline_keyboard: [choices, [button(zh ? "‹ 返回" : "‹ Back", "menu:main")]] };
}

export function workspaceKeyboard(context: AppContext, chatId: ChatId, page = 0): InlineKeyboardMarkup {
  const pageSize = 6;
  const currentSettings = settingsFor(context, chatId);
  const activeWs = currentSettings.workspace;
  const workspaces = listAvailableWorkspaces(context.config.agy.projectsRoot, context.config.agy.workspace);
  const totalPages = Math.max(1, Math.ceil(workspaces.length / pageSize));
  const normalizedPage = Math.min(Math.max(page, 0), totalPages - 1);
  const slice = workspaces.slice(normalizedPage * pageSize, normalizedPage * pageSize + pageSize);

  const rows: InlineButton[][] = [];
  for (let i = 0; i < slice.length; i += 2) {
    const row: InlineButton[] = [];
    const item1 = slice[i];
    const isSelected1 = activeWs === item1.path;
    row.push(button(`${isSelected1 ? "✅ " : "📁 "}${item1.name}`, `set:ws:${item1.name}`));
    if (slice[i + 1]) {
      const item2 = slice[i + 1];
      const isSelected2 = activeWs === item2.path;
      row.push(button(`${isSelected2 ? "✅ " : "📁 "}${item2.name}`, `set:ws:${item2.name}`));
    }
    rows.push(row);
  }

  if (totalPages > 1) {
    const navigation: InlineButton[] = [];
    if (normalizedPage > 0) navigation.push(button("‹", `menu:workspace:${normalizedPage - 1}`));
    navigation.push(button(`${normalizedPage + 1}/${totalPages}`, "noop"));
    if (normalizedPage < totalPages - 1) navigation.push(button("›", `menu:workspace:${normalizedPage + 1}`));
    rows.push(navigation);
  }

  const isZh = (process.env.BOT_LANGUAGE || "").toLowerCase().startsWith("zh");
  const actionsRow: InlineButton[] = [];
  if (activeWs) {
    actionsRow.push(button(isZh ? "🔄 重置默认" : "🔄 Reset default", "set:ws:clear"));
  }
  actionsRow.push(button(isZh ? "‹ 返回" : "‹ Back", "menu:main"));
  rows.push(actionsRow);

  return { inline_keyboard: rows };
}

export function profileLabel(profile: import("../types.js").MenuProfile): string {
  const isZh = (process.env.BOT_LANGUAGE || "").toLowerCase().startsWith("zh");
  if (profile === "daily") return isZh ? "日常模式" : "Daily";
  if (profile === "dev") return isZh ? "开发模式" : "Dev";
  return isZh ? "均衡模式" : "Mixed";
}

export function menuProfileKeyboard(currentProfile: import("../types.js").MenuProfile): InlineKeyboardMarkup {
  const isZh = (process.env.BOT_LANGUAGE || "").toLowerCase().startsWith("zh");
  const profiles: Array<{ id: import("../types.js").MenuProfile; label: string; desc: string }> = [
    { id: "mixed", label: isZh ? "均衡" : "Mixed", desc: isZh ? "常用功能 (默认)" : "Balanced (default)" },
    { id: "daily", label: isZh ? "日常" : "Daily", desc: isZh ? "极简与语音" : "Minimalist & Voice" },
    { id: "dev", label: isZh ? "开发" : "Dev", desc: isZh ? "工作区与上下文" : "Workspace & Context" },
  ];
  const rows: InlineButton[][] = profiles.map((p) => [
    button(`${p.id === currentProfile ? "✅ " : ""}${p.label} - ${p.desc}`, `set:profile:${p.id}`),
  ]);
  rows.push([button(isZh ? "‹ 返回菜单" : "‹ Back to Menu", "menu:main")]);
  return { inline_keyboard: rows };
}

export function mainInlineKeyboard(context?: AppContext, chatId?: ChatId): InlineKeyboardMarkup {
  const currentSettings = context && chatId ? settingsFor(context, chatId) : null;
  const zh = isZh(currentSettings, context, chatId);
  const profile = currentSettings?.menuProfile || "mixed";
  const profileBtn = button(zh ? `🔄 模式: ${profileLabel(profile)} ▾` : `🔄 Profile: ${profileLabel(profile)} ▾`, "menu:profile");
  const closeBtn = button(zh ? "❌ 关闭" : "❌ Close", "action:cancel");
  const langBtn = button(zh ? "🌐 语言: 中文" : "🌐 Lang: English", "menu:lang");

  if (profile === "daily") {
    return {
      inline_keyboard: [
        [button(zh ? "🤖 模型" : "🤖 Model", "menu:models"), button(zh ? "🧠 思考深度" : "🧠 Effort", "menu:effort")],
        [button(zh ? "🎙️ 语音设置" : "🎙️ Voice Settings", "menu:voice"), button(zh ? "📂 历史/恢复" : "📂 History / Resume", "menu:resume")],
        [langBtn, profileBtn],
        [closeBtn],
      ],
    };
  }

  if (profile === "dev") {
    const session = context && chatId ? context.state.session(chatId) : null;
    return {
      inline_keyboard: [
        [button(zh ? "📁 工作区" : "📁 Workspace", "menu:workspace"), button(zh ? "📂 恢复会话" : "📂 Resume Session", "menu:resume")],
        [button(zh ? "⚙️ 模式(规划/编辑)" : "⚙️ Mode (Plan/Edit)", "menu:mode"), button(zh ? "🛡️ 沙箱保护" : "🛡️ Sandbox", "menu:sandbox")],
        [button(zh ? "🤖 模型" : "🤖 Model", "menu:models"), button(zh ? "🧠 思考深度" : "🧠 Effort", "menu:effort")],
        [button(zh ? "🛠️ CLI 与工具" : "🛠️ CLI & Tools", "menu:clitools"), button(contextButtonLabel(session, zh), "action:context")],
        [langBtn, profileBtn],
        [closeBtn],
      ],
    };
  }

  // Mixed / Balanced Profile (Default)
  return {
    inline_keyboard: [
      [button(zh ? "🤖 模型" : "🤖 Model", "menu:models"), button(zh ? "🧠 思考深度" : "🧠 Effort", "menu:effort")],
      [button(zh ? "📁 工作区" : "📁 Workspace", "menu:workspace"), button(zh ? "📂 恢复会话" : "📂 Resume Session", "menu:resume")],
      [button(zh ? "🎙️ 语音设置" : "🎙️ Voice Settings", "menu:voice"), button(zh ? "🛠️ CLI 与工具" : "🛠️ CLI & Tools", "menu:clitools")],
      [langBtn, profileBtn],
      [closeBtn],
    ],
  };
}

export function modeSandboxKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const settings = settingsFor(context, chatId);
  return {
    inline_keyboard: [
      [button(`⚙️ Mode: ${settings.mode}`, "menu:mode"), button(`🛡️ Sandbox: ${settings.sandbox ? "On" : "Off"}`, "menu:sandbox")],
      [button(`Verbose: ${settings.verbose || "detailed"}`, "menu:verbose"), button("Session Info", "menu:session")],
      [button("‹ Back", "menu:main")],
    ],
  };
}

export function cliToolsKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const session = context.state.session(chatId);
  return {
    inline_keyboard: [
      [button("⚙️ Mode & Sandbox", "menu:modesandbox"), button("🛠️ CLI Options", "menu:cli")],
      [button("AGY Agents", "cli:agents"), button("⚡ Skills", "cli:skills")],
      [button("🧩 Plugins", "menu:plugins"), button("🛠️ MCP", "menu:mcp")],
      [button(contextButtonLabel(session), "action:context"), button("Custom /agy", "menu:custom")],
      [button("Changelog", "cli:changelog"), button("CLI Help", "cli:help")],
      [button("CLI Version", "cli:version"), button("Update CLI", "cli:update")],
      [button("🔄 Update Bot", "action:update_bot"), button("💾 Set as Default", "action:setdefault")],
      [button("New session", "action:new")],
      [button("‹ Back", "menu:main")],
    ],
  };
}

export function voiceSettingsKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const settings = settingsFor(context, chatId);
  const stt = settings.sttProvider || context.config.stt.provider || "none";
  const tts = settings.ttsMode || context.config.tts?.mode || "off";
  return {
    inline_keyboard: [
      [button(`🎙️ STT (${stt})`, "menu:stt"), button(`🔊 TTS (${tts})`, "menu:tts")],
      [button("‹ Back", "menu:main")],
    ],
  };
}

export function cliOptionsKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const settings = settingsFor(context, chatId);
  return {
    inline_keyboard: [
      [button("Project", "cli:project"), button("Agent", "cli:agent")],
      [button(`Continue: ${settings.continueSession ? "on" : "off"}`, "toggle:continue"), button(`New project: ${settings.newProject ? "on" : "off"}`, "toggle:new-project")],
      [button(`Output: ${settings.outputFormat}`, "menu:output"), button(`Slash cmds: ${settings.disableSlashCommands ? "off" : "on"}`, "toggle:disable-slash")],
      [button("Add directory", "cli:add-dir"), button("JSON schema", "cli:json-schema")],
      [button("Log file", "cli:log-file"), button("Print timeout", "cli:print-timeout")],
      [button("Conversation ID", "cli:conversation"), button("Prompt flags", "cli:prompt")],
      [button("‹ Back", "menu:clitools")],
    ],
  };
}

export function outputFormatKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const selected = settingsFor(context, chatId).outputFormat;
  return {
    inline_keyboard: [
      ["text", "json", "stream-json"].map((value) => button(`${selected === value ? "✅ " : ""}${value}`, `set:output:${value}`)),
      [button("‹ Back", "menu:cli")],
    ],
  };
}

export function sttKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const settings = settingsFor(context, chatId);
  const provider = settings.sttProvider || context.config.stt.provider;
  const whisperModel = settings.sttWhisperModel || context.config.stt.whisperModel;
  const lang = settings.sttLang || context.config.stt.language;

  const rows: InlineKeyboardMarkup["inline_keyboard"] = [
    [button(`🎙️ Provider: ${provider}`, "menu:stt:provider")],
  ];

  if (provider === "whisper-local") {
    rows.push([
      button(`🧠 Whisper: ${whisperModel}`, "menu:stt:whisper"),
      button(`🌐 Lang: ${lang}`, "menu:stt:lang"),
    ]);
  } else if (provider !== "none") {
    rows.push([button(`🌐 Lang: ${lang}`, "menu:stt:lang")]);
  }

  rows.push([button("‹ Back", "menu:main")]);
  return { inline_keyboard: rows };
}

export function sttProviderKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const settings = settingsFor(context, chatId);
  const selected = settings.sttProvider || context.config.stt.provider;
  const choices: Array<"whisper-local" | "gemini" | "agy" | "none"> = [
    "whisper-local",
    "gemini",
    "agy",
    "none",
  ];
  const rows = choices.map((choice) => [
    button(`${choice === selected ? "✅ " : ""}${choice}`, `set:stt:provider:${choice}`),
  ]);
  rows.push([button("‹ Back", "menu:stt")]);
  return { inline_keyboard: rows };
}

export function sttWhisperModelKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const settings = settingsFor(context, chatId);
  const selected = settings.sttWhisperModel || context.config.stt.whisperModel;
  const choices = ["tiny", "base", "small", "medium"];
  const rows = choices.map((choice) => [
    button(`${choice === selected ? "✅ " : ""}${choice}`, `set:stt:whisper:${choice}`),
  ]);
  rows.push([button("‹ Back", "menu:stt")]);
  return { inline_keyboard: rows };
}

export function sttLangKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const settings = settingsFor(context, chatId);
  const selected = settings.sttLang || context.config.stt.language || "auto";
  const choices = [
    { label: "Auto-detect", id: "auto" },
    { label: "English", id: "en" },
    { label: "German", id: "de" },
    { label: "French", id: "fr" },
    { label: "Italian", id: "it" },
    { label: "Spanish", id: "es" },
  ];
  const rows = choices.map((choice) => [
    button(`${choice.id === selected ? "✅ " : ""}${choice.label} (${choice.id})`, `set:stt:lang:${choice.id}`),
  ]);
  rows.push([button("‹ Back", "menu:stt")]);
  return { inline_keyboard: rows };
}

export function ttsKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const settings = settingsFor(context, chatId);
  const mode = settings.ttsMode || context.config.tts?.mode || "off";
  const voice = settings.ttsVoice || context.config.tts?.voice || "en-US-AndrewMultilingualNeural";
  const displayVoice = voice.replace(/^(en-US-|en-GB-|de-DE-)/, "").replace("Neural", "");

  return {
    inline_keyboard: [
      [button(`🔊 Mode: ${mode}`, "menu:tts:mode")],
      [button(`🗣️ Voice: ${displayVoice}`, "menu:tts:voice")],
      [button("‹ Back", "menu:main")],
    ],
  };
}

export function ttsModeKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const settings = settingsFor(context, chatId);
  const selected = settings.ttsMode || context.config.tts?.mode || "off";
  const choices: Array<"off" | "voice-only" | "voice-and-text" | "auto"> = ["off", "voice-only", "voice-and-text", "auto"];
  const rows = choices.map((choice) => [
    button(`${choice === selected ? "✅ " : ""}${choice}`, `set:tts:mode:${choice}`),
  ]);
  rows.push([button("‹ Back", "menu:tts")]);
  return { inline_keyboard: rows };
}

export function ttsVoiceKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const settings = settingsFor(context, chatId);
  const selected = settings.ttsVoice || context.config.tts?.voice || "en-US-AndrewMultilingualNeural";
  const choices = [
    { label: "Andrew (English - US, Multilingual Male)", id: "en-US-AndrewMultilingualNeural" },
    { label: "Ava (English - US, Multilingual Female)", id: "en-US-AvaMultilingualNeural" },
    { label: "Brian (English - US, Multilingual Male)", id: "en-US-BrianMultilingualNeural" },
    { label: "Emma (English - US, Multilingual Female)", id: "en-US-EmmaMultilingualNeural" },
    { label: "Sonia (English - UK Female)", id: "en-GB-SoniaNeural" },
    { label: "Ryan (English - UK Male)", id: "en-GB-RyanNeural" },
    { label: "Florian (German Multilingual Male)", id: "de-DE-FlorianMultilingualNeural" },
    { label: "Seraphina (German Multilingual Female)", id: "de-DE-SeraphinaMultilingualNeural" },
    { label: "Conrad (German Male)", id: "de-DE-ConradNeural" },
    { label: "Katja (German Female)", id: "de-DE-KatjaNeural" },
  ];
  const rows = choices.map((choice) => [
    button(`${choice.id === selected ? "✅ " : ""}${choice.label}`, `set:tts:voice:${choice.id}`),
  ]);
  rows.push([button("‹ Back", "menu:tts")]);
  return { inline_keyboard: rows };
}


