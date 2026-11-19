import type { AppContext } from "../context.js";
import { TOP_LEVEL_COMMANDS } from "../agy-runner.js";
import { getActiveEfforts, getActiveModes, getDiscoveredSubcommands } from "../cli-capabilities.js";
import { formatRelativeTime } from "../db.js";
import { settingsFor } from "../domain/settings.js";
import { listAvailableWorkspaces } from "../domain/workspace.js";
import { resolveLang, t, type Lang } from "../i18n/index.js";
import { getActiveModels, getModelFamilies, modelBaseId } from "../models.js";
import type { ChatId, ConversationSummary, InlineButton, InlineKeyboardMarkup, MenuProfile, PendingInputKind, SessionState } from "../types.js";

export function button(text: string, callback_data: string): { text: string; callback_data: string } {
  return { text, callback_data };
}

export function backKeyboard(zh = false): InlineKeyboardMarkup {
  const lang: Lang = zh ? "zh" : "en";
  return { inline_keyboard: [[button(t(lang, "common.back"), "menu:main")]] };
}

export function pendingInputKeyboard(kind: PendingInputKind, hasValue: boolean, lang: Lang): InlineKeyboardMarkup {
  const rows: InlineButton[][] = [];
  const actions: InlineButton[] = [];
  if (hasValue && kind !== "custom-agy") {
    actions.push(button(t(lang, "common.clear"), `input:clear:${kind}`));
  }
  actions.push(button(t(lang, "common.cancelInput"), "input:cancel"));
  rows.push(actions);
  return { inline_keyboard: rows };
}

export function remoteControlKeyboard(active: boolean, zh = false): InlineKeyboardMarkup {
  const lang: Lang = zh ? "zh" : "en";
  return {
    inline_keyboard: [
      active
        ? [button(t(lang, "rc.stopBtn"), "action:remote-stop")]
        : [button(t(lang, "rc.startBtn"), "action:remote-start")],
      [button(t(lang, "common.refresh"), "menu:remote-control"), button(t(lang, "common.backToCliTools"), "menu:clitools")],
    ],
  };
}

export function contextActionsKeyboard(zh = false): InlineKeyboardMarkup {
  const lang: Lang = zh ? "zh" : "en";
  return {
    inline_keyboard: [
      [button(t(lang, "ctx.compact"), "action:compact"), button(t(lang, "common.refresh"), "action:context")],
      [button(t(lang, "ctx.fork"), "action:fork"), button(t(lang, "ctx.rewind"), "action:rewind")],
    ],
  };
}

export function inFlightProgressKeyboard(lang: Lang): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        button(t(lang, "progress.stopBtn"), "action:cancel"),
        button(t(lang, "progress.btwBtn"), "action:btw-inline"),
      ],
    ],
  };
}

export interface PostTurnActionOptions {
  mode: string;
  hasGitChanges: boolean;
  contextPct?: number;
  toolCalls?: number;
  lang: Lang;
  isPlanSeekingApproval?: boolean;
}

export function postTurnActionKeyboard(opts: PostTurnActionOptions): InlineKeyboardMarkup | null {
  const { mode, hasGitChanges, contextPct, toolCalls, lang, isPlanSeekingApproval } = opts;
  const rows: InlineButton[][] = [];

  if (mode === "plan" && isPlanSeekingApproval) {
    rows.push([
      button(t(lang, "postturn.approvePlan"), "action:approve-plan"),
      button(t(lang, "postturn.grillPlan"), "cli:directive-grill-me"),
    ]);
  } else if (hasGitChanges) {
    rows.push([
      button(t(lang, "postturn.viewDiff"), "action:diff"),
      button(t(lang, "postturn.gitCommit"), "action:git-commit"),
      button(t(lang, "postturn.rewind"), "action:rewind"),
    ]);
  } else if ((toolCalls ?? 0) > 0) {
    rows.push([
      button(t(lang, "postturn.viewDiff"), "action:diff"),
      button(t(lang, "postturn.rewind"), "action:rewind"),
    ]);
  }

  if (typeof contextPct === "number" && contextPct >= 65) {
    rows.push([
      button(t(lang, "postturn.compact", { pct: Math.round(contextPct) }), "action:compact"),
      button(t(lang, "postturn.fork"), "action:fork"),
    ]);
  }

  return rows.length > 0 ? { inline_keyboard: rows } : null;
}

export function contextButtonLabel(session?: SessionState | null, zh = false): string {
  const lang: Lang = zh ? "zh" : "en";
  if (session?.contextTokens) {
    const pct = session.contextPercentage !== undefined ? ` (${session.contextPercentage}%)` : "";
    return `🧠 ${session.contextTokens}${pct}`;
  }
  return t(lang, "menu.activeContext");
}

export function resumeKeyboard(page = 0, totalPages = 1, items: ConversationSummary[] = [], zh = false): InlineKeyboardMarkup {
  const lang: Lang = zh ? "zh" : "en";
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
        `resume:use:${item.conversation_id}`,
      ),
    ];
  });
  const navigation: InlineButton[] = [];
  if (page > 0) navigation.push(button(t(lang, "resume.prev"), `resume:page:${page - 1}`));
  navigation.push(button(`${page + 1}/${totalPages}`, "noop"));
  if (page < totalPages - 1) navigation.push(button(t(lang, "resume.next"), `resume:page:${page + 1}`));
  if (navigation.length) rows.push(navigation);
  rows.push([button(t(lang, "common.back"), "menu:main")]);
  return { inline_keyboard: rows };
}

export function modelKeyboard(context: AppContext, chatId: ChatId, page = 0): InlineKeyboardMarkup {
  const settings = settingsFor(context, chatId);
  const lang = resolveLang(settings, context, chatId);
  const pageSize = 6;
  const families = getModelFamilies(getActiveModels());
  const totalPages = Math.max(1, Math.ceil(families.length / pageSize));
  const normalizedPage = Math.min(Math.max(page, 0), totalPages - 1);
  const selectedId = settings.model;
  const selectedBase = modelBaseId(selectedId);

  const rows: InlineButton[][] = families
    .slice(normalizedPage * pageSize, normalizedPage * pageSize + pageSize)
    .map((family) => {
      const isSelected = Boolean(selectedId && (selectedId === family.baseId || selectedBase === family.baseId));
      const activeVariant = isSelected ? family.variants.find((v) => v.id === selectedId) : null;
      const activeEffortSuffix = activeVariant?.id.match(/-(low|medium|high|xhigh|max|ultra)$/i)?.[1];
      const effortBadge = family.efforts.length > 0
        ? isSelected && activeEffortSuffix
          ? ` · 🧠 ${activeEffortSuffix}`
          : ` (${family.efforts.join("/")})`
        : "";
      return [
        button(
          `${isSelected ? "✅ " : ""}${family.baseLabel}${effortBadge}`,
          `set:model:${family.baseId}`,
        ),
      ];
    });

  // If the currently selected model family supports multiple effort tiers, embed a 1-tap effort bar right inside the model picker (just like AGY CLI!)
  const activeFamily = families.find((f) => selectedBase && f.baseId === selectedBase);
  if (activeFamily && activeFamily.efforts.length > 1) {
    const currentEff = (selectedId?.match(/-(low|medium|high|xhigh|max|ultra)$/i)?.[1] || settings.effort || "high").toLowerCase();
    const effRow = activeFamily.efforts.map((eff) =>
      button(
        `${eff === currentEff ? "🧠 " : ""}${eff}`,
        `set:model:${activeFamily.baseId}-${eff}`,
      ),
    );
    rows.push(effRow);
  }

  if (totalPages > 1) {
    const navigation = [];
    if (normalizedPage > 0) navigation.push(button("‹", `menu:models:${normalizedPage - 1}`));
    navigation.push(button(`${normalizedPage + 1}/${totalPages}`, "noop"));
    if (normalizedPage < totalPages - 1) navigation.push(button("›", `menu:models:${normalizedPage + 1}`));
    rows.push(navigation);
  }
  rows.push([button(t(lang, "common.back"), "menu:main")]);
  return { inline_keyboard: rows };
}

export function effortKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const settings = settingsFor(context, chatId);
  const lang = resolveLang(settings, context, chatId);
  const selected = settings.effort;
  const activeBase = modelBaseId(settings.model);
  const activeFamily = getModelFamilies(getActiveModels()).find((f) => activeBase && f.baseId === activeBase);
  const globalEfforts = getActiveEfforts();
  const values = activeFamily && activeFamily.efforts.length > 0
    ? Array.from(new Set([...activeFamily.efforts, ...globalEfforts.filter((e) => !["low", "medium", "high", "xhigh", "max"].includes(e))]))
    : globalEfforts;
  const zhEffortLabels: Record<string, string> = {
    low: "低 (low)",
    medium: "中 (medium)",
    high: "高 (high)",
    xhigh: "极高 (xhigh)",
    max: "最大 (max)",
  };
  const buttons = values.map((value) => {
    const label = lang === "zh" ? (zhEffortLabels[value] || value) : value;
    return button(`${value === selected ? "✅ " : ""}${label}`, `set:effort:${value}`);
  });
  const rows: InlineButton[][] = [];
  for (let i = 0; i < buttons.length; i += 3) {
    rows.push(buttons.slice(i, i + 3));
  }
  rows.push([button(t(lang, "common.back"), "menu:main")]);
  return { inline_keyboard: rows };
}

export function modeKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const lang = resolveLang(settingsFor(context, chatId), context, chatId);
  const selected = settingsFor(context, chatId).mode;
  const values = getActiveModes();
  const zhModeLabels: Record<string, string> = {
    plan: "规划 (plan)",
    "accept-edits": "自动编辑 (accept-edits)",
    auto: "全自动 (auto)",
  };
  const choices = values.map((value) => {
    const label = lang === "zh" ? (zhModeLabels[value] || value) : value;
    return button(`${value === selected ? "✅ " : ""}${label}`, `set:mode:${value}`);
  });
  const rows: InlineButton[][] = [];
  for (let i = 0; i < choices.length; i += 2) {
    rows.push(choices.slice(i, i + 2));
  }
  rows.push([button(t(lang, "common.back"), "menu:main")]);
  return { inline_keyboard: rows };
}

export function sandboxKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const lang = resolveLang(settingsFor(context, chatId), context, chatId);
  const selected = settingsFor(context, chatId).sandbox;
  const disableAllowed = context.config.agy.allowSandboxDisable || !context.config.agy.sandbox;
  const onLabel = t(lang, "common.on");
  const offLabel = t(lang, "common.off");
  const lockedLabel = t(lang, "common.locked");
  return {
    inline_keyboard: [
      [
        button(`${selected ? "✅ " : ""}${onLabel}`, "set:sandbox:on"),
        button(`${!selected ? "✅ " : ""}${offLabel}${disableAllowed ? "" : lockedLabel}`, disableAllowed ? "set:sandbox:off" : "noop"),
      ],
      [button(t(lang, "common.back"), "menu:main")],
    ],
  };
}

export function verboseKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const lang = resolveLang(settingsFor(context, chatId), context, chatId);
  const selected = settingsFor(context, chatId).verbose || "detailed";
  const choices = (["detailed", "compact", "silent"] as const).map((value) => {
    const label = lang === "zh" ? `${t(lang, `verbose.${value}`)} (${value})` : value;
    return button(`${value === selected ? "✅ " : ""}${label}`, `set:verbose:${value}`);
  });
  return { inline_keyboard: [choices, [button(t(lang, "common.back"), "menu:main")]] };
}

export function workspaceKeyboard(context: AppContext, chatId: ChatId, page = 0): InlineKeyboardMarkup {
  const pageSize = 6;
  const currentSettings = settingsFor(context, chatId);
  const lang = resolveLang(currentSettings, context, chatId);
  const activeWs = currentSettings.workspace;
  const workspaces = listAvailableWorkspaces(context.config.agy.projectsRoot, context.config.agy.workspace);
  const totalPages = Math.max(1, Math.ceil(workspaces.length / pageSize));
  const normalizedPage = Math.min(Math.max(page, 0), totalPages - 1);
  const slice = workspaces.slice(normalizedPage * pageSize, normalizedPage * pageSize + pageSize);

  const formatWsLabel = (item: { name: string; path: string; gitBranch?: string; gitDirtyCount?: number }): string => {
    const isSelected = activeWs === item.path;
    const prefix = isSelected ? "✅ " : "📁 ";
    if (!item.gitBranch) return `${prefix}${item.name}`;
    const branchShort = item.gitBranch.length > 10 ? `${item.gitBranch.slice(0, 9)}…` : item.gitBranch;
    const dirtyTag = item.gitDirtyCount && item.gitDirtyCount > 0 ? `·${item.gitDirtyCount}M` : "";
    const nameShort = item.name.length > 16 ? `${item.name.slice(0, 15)}…` : item.name;
    return `${prefix}${nameShort} (${branchShort}${dirtyTag})`;
  };

  const rows: InlineButton[][] = [];
  for (let i = 0; i < slice.length; i += 2) {
    const row: InlineButton[] = [];
    const item1 = slice[i];
    row.push(button(formatWsLabel(item1), `set:ws:${item1.name}`));
    if (slice[i + 1]) {
      const item2 = slice[i + 1];
      row.push(button(formatWsLabel(item2), `set:ws:${item2.name}`));
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

  rows.push([button(t(lang, "git.cloneBtn"), "cli:git-clone")]);

  const actionsRow: InlineButton[] = [];
  if (activeWs) {
    actionsRow.push(button(t(lang, "common.resetDefault"), "set:ws:clear"));
  }
  actionsRow.push(button(t(lang, "common.back"), "menu:main"));
  rows.push(actionsRow);

  return { inline_keyboard: rows };
}

export function profileLabel(profile: MenuProfile, lang: Lang = "en"): string {
  if (profile === "daily") return t(lang, "profile.daily");
  if (profile === "dev") return t(lang, "profile.dev");
  return t(lang, "profile.mixed");
}

export function menuProfileKeyboard(currentProfile: MenuProfile, lang: Lang = "en"): InlineKeyboardMarkup {
  const profiles: Array<{ id: MenuProfile; label: string; desc: string }> = [
    { id: "mixed", label: t(lang, "profile.mixed"), desc: t(lang, "profile.mixedDesc") },
    { id: "daily", label: t(lang, "profile.daily"), desc: t(lang, "profile.dailyDesc") },
    { id: "dev", label: t(lang, "profile.dev"), desc: t(lang, "profile.devDesc") },
  ];
  const rows: InlineButton[][] = profiles.map((p) => [
    button(`${p.id === currentProfile ? "✅ " : ""}${p.label} - ${p.desc}`, `set:profile:${p.id}`),
  ]);
  rows.push([button(t(lang, "common.backToMenu"), "menu:main")]);
  return { inline_keyboard: rows };
}

export function mainInlineKeyboard(context?: AppContext, chatId?: ChatId): InlineKeyboardMarkup {
  const currentSettings = context && chatId ? settingsFor(context, chatId) : null;
  const lang = resolveLang(currentSettings, context, chatId);
  const zh = lang === "zh";
  const profile = currentSettings?.menuProfile || "mixed";
  const profileBtn = button(t(lang, "menu.profileBtn", { profile: profileLabel(profile, lang) }), "menu:profile");
  const closeBtn = button(t(lang, "common.close"), "action:cancel");
  const langBtn = button(t(lang, "menu.lang"), "menu:lang");
  const guideBtn = button(t(lang, "menu.guide"), "menu:guide");
  const directivesBtn = button(t(lang, "menu.directives"), "menu:directives");

  if (profile === "daily") {
    return {
      inline_keyboard: [
        [button(t(lang, "menu.models"), "menu:models"), button(t(lang, "menu.effort"), "menu:effort")],
        [button(t(lang, "menu.voice"), "menu:voice"), button(t(lang, "menu.historyResume"), "menu:resume")],
        [guideBtn, directivesBtn],
        [langBtn, profileBtn],
        [closeBtn],
      ],
    };
  }

  if (profile === "dev") {
    const session = context && chatId ? context.state.session(chatId) : null;
    return {
      inline_keyboard: [
        [button(t(lang, "menu.workspace"), "menu:workspace"), button(t(lang, "menu.resume"), "menu:resume")],
        [button(t(lang, "menu.modeEdit"), "menu:mode"), button(t(lang, "menu.sandbox"), "menu:sandbox")],
        [button(t(lang, "menu.models"), "menu:models"), button(t(lang, "menu.effort"), "menu:effort")],
        [button(t(lang, "menu.cliTools"), "menu:clitools"), button(contextButtonLabel(session, zh), "action:context")],
        [directivesBtn, guideBtn],
        [langBtn, profileBtn],
        [closeBtn],
      ],
    };
  }

  // Mixed / Balanced Profile (Default)
  return {
    inline_keyboard: [
      [button(t(lang, "menu.models"), "menu:models"), button(t(lang, "menu.effort"), "menu:effort")],
      [button(t(lang, "menu.workspace"), "menu:workspace"), button(t(lang, "menu.resume"), "menu:resume")],
      [directivesBtn, guideBtn],
      [button(t(lang, "menu.voice"), "menu:voice"), button(t(lang, "menu.cliTools"), "menu:clitools")],
      [langBtn, profileBtn],
      [closeBtn],
    ],
  };
}

export function guideKeyboard(activeTab: "new" | "directives" | "session" | "tools", lang: Lang = "zh"): InlineKeyboardMarkup {
  const tabs: Array<{ id: "new" | "directives" | "session" | "tools"; labelKey: Parameters<typeof t>[1] }> = [
    { id: "new", labelKey: "guide.tabNew" },
    { id: "directives", labelKey: "guide.tabDirectives" },
    { id: "session", labelKey: "guide.tabSession" },
    { id: "tools", labelKey: "guide.tabTools" },
  ];
  const tabBtns = tabs.map((tab) =>
    button(`${tab.id === activeTab ? "• " : ""}${t(lang, tab.labelKey)}`, `menu:guide:${tab.id}`),
  );
  const rows: InlineButton[][] = [
    [tabBtns[0], tabBtns[1]],
    [tabBtns[2], tabBtns[3]],
  ];

  if (activeTab === "new") {
    rows.push([button(t(lang, "menu.mode"), "menu:mode"), button(t(lang, "menu.effort"), "menu:effort")]);
    rows.push([button(t(lang, "clitools.remoteControl"), "menu:remote-control"), button(t(lang, "clitools.cliCheck"), "cli:check")]);
  } else if (activeTab === "directives") {
    rows.push([button(t(lang, "directives.planBtn"), "cli:directive-plan"), button(t(lang, "directives.boostBtn"), "cli:directive-boost")]);
    rows.push([button(t(lang, "directives.goalBtn"), "cli:directive-goal"), button(t(lang, "directives.grillBtn"), "cli:directive-grill-me")]);
    rows.push([button(t(lang, "directives.learnNowBtn"), "action:learn-now")]);
  } else if (activeTab === "session") {
    rows.push([button(t(lang, "ctx.compact"), "action:compact"), button(t(lang, "ctx.fork"), "action:fork")]);
    rows.push([button(t(lang, "ctx.rewind"), "action:rewind"), button(t(lang, "clitools.backup"), "action:backup")]);
  } else if (activeTab === "tools") {
    rows.push([button(t(lang, "clitools.skills"), "cli:skills"), button(t(lang, "clitools.mcp"), "menu:mcp")]);
    rows.push([button(t(lang, "clitools.plugins"), "menu:plugins"), button(t(lang, "clitools.agents"), "cli:agents")]);
  }

  rows.push([button(t(lang, "common.backToMenu"), "menu:main")]);
  return { inline_keyboard: rows };
}

export function directivesKeyboard(lang: Lang = "zh"): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [button(t(lang, "directives.planBtn"), "cli:directive-plan"), button(t(lang, "directives.boostBtn"), "cli:directive-boost")],
      [button(t(lang, "directives.goalBtn"), "cli:directive-goal"), button(t(lang, "directives.grillBtn"), "cli:directive-grill-me")],
      [button(t(lang, "directives.learnNowBtn"), "action:learn-now")],
      [button(t(lang, "directives.learnCustomBtn"), "cli:directive-learn")],
      [button(t(lang, "common.backToMenu"), "menu:main")],
    ],
  };
}

export function pluginsKeyboard(lang: Lang = "zh"): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [button(t(lang, "plugins.listBtn"), "cli:plugins")],
      [button(t(lang, "plugins.installBtn"), "cli:plugin-install"), button(t(lang, "plugins.uninstallBtn"), "cli:plugin-uninstall")],
      [button(t(lang, "plugins.enableBtn"), "cli:plugin-enable"), button(t(lang, "plugins.disableBtn"), "cli:plugin-disable")],
      [button(t(lang, "common.backToCliTools"), "menu:clitools")],
    ],
  };
}

export function mcpKeyboard(lang: Lang = "zh"): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [button(t(lang, "mcp.listBtn"), "cli:mcp")],
      [button(t(lang, "mcp.enableBtn"), "cli:mcp-enable"), button(t(lang, "mcp.disableBtn"), "cli:mcp-disable")],
      [button(t(lang, "common.backToCliTools"), "menu:clitools")],
    ],
  };
}

export function modeSandboxKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const settings = settingsFor(context, chatId);
  const lang = resolveLang(settings, context, chatId);
  return {
    inline_keyboard: [
      [
        button(t(lang, "modesandbox.modeBtn", { mode: settings.mode }), "menu:mode"),
        button(t(lang, "modesandbox.sandboxBtn", { state: settings.sandbox ? t(lang, "common.on") : t(lang, "common.off") }), "menu:sandbox"),
      ],
      [
        button(t(lang, "modesandbox.verboseBtn", { level: settings.verbose || "detailed" }), "menu:verbose"),
        button(t(lang, "modesandbox.sessionBtn"), "menu:session"),
      ],
      [button(t(lang, "modesandbox.autotopicBtn", { state: settings.autoTopicRename ? t(lang, "common.on") : t(lang, "common.off") }), "toggle:autotopic")],
      [button(t(lang, "common.back"), "menu:main")],
    ],
  };
}

export function cliToolsKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const session = context.state.session(chatId);
  const settings = settingsFor(context, chatId);
  const lang = resolveLang(settings, context, chatId);
  const zh = lang === "zh";
  const rows: InlineButton[][] = [
    [button(t(lang, "clitools.modeSandbox"), "menu:modesandbox"), button(t(lang, "clitools.cliOptions"), "menu:cli")],
    [button(t(lang, "clitools.agents"), "cli:agents"), button(t(lang, "clitools.skills"), "cli:skills")],
    [button(t(lang, "clitools.plugins"), "menu:plugins"), button(t(lang, "clitools.mcp"), "menu:mcp")],
    [button(contextButtonLabel(session, zh), "action:context"), button(t(lang, "clitools.custom"), "menu:custom")],
    [button(t(lang, "clitools.changelog"), "cli:changelog"), button(t(lang, "clitools.help"), "cli:help")],
    [button(t(lang, "clitools.version"), "cli:version"), button(t(lang, "clitools.cliCheck"), "cli:check")],
    [button(t(lang, "clitools.doctor"), "menu:doctor"), button(t(lang, "clitools.backup"), "action:backup")],
    [button(t(lang, "clitools.updateCli"), "cli:update"), button(t(lang, "clitools.updateBot"), "action:update_bot")],
    [button(t(lang, "clitools.setDefault"), "action:setdefault"), button(t(lang, "clitools.remoteControl"), "menu:remote-control")],
    [button(t(lang, "modesandbox.autotopicBtn", { state: settings.autoTopicRename ? t(lang, "common.on") : t(lang, "common.off") }), "toggle:autotopic")],
  ];

  // Automatically expose any newly discovered AGY CLI subcommands as 1-tap buttons!
  const newSubcommands = getDiscoveredSubcommands().filter((sub) => !TOP_LEVEL_COMMANDS.has(sub));
  if (newSubcommands.length > 0) {
    const subBtns = newSubcommands.map((sub) => button(`🆕 agy ${sub}`, `cli:sub:${sub}`));
    for (let i = 0; i < subBtns.length; i += 2) {
      rows.push(subBtns.slice(i, i + 2));
    }
  }

  rows.push([button(t(lang, "common.back"), "menu:main")]);
  return { inline_keyboard: rows };
}

export function voiceSettingsKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const settings = settingsFor(context, chatId);
  const lang = resolveLang(settings, context, chatId);
  const stt = settings.sttProvider || context.config.stt.provider || "none";
  const tts = settings.ttsMode || context.config.tts?.mode || "off";
  return {
    inline_keyboard: [
      [button(`🎙️ STT (${stt})`, "menu:stt"), button(`🔊 TTS (${tts})`, "menu:tts")],
      [button(t(lang, "common.back"), "menu:main")],
    ],
  };
}

export function cliOptionsKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const settings = settingsFor(context, chatId);
  const lang = resolveLang(settings, context, chatId);
  const onOff = (b?: boolean) => (b ? t(lang, "common.on") : t(lang, "common.off"));
  return {
    inline_keyboard: [
      [button(`${t(lang, "cliopts.project")}${settings.project ? ` (${settings.project})` : ""}`, "cli:project"), button(`${t(lang, "cliopts.agent")}${settings.agent ? ` (${settings.agent})` : ""}`, "cli:agent")],
      [button(`${t(lang, "cliopts.continue")}: ${onOff(settings.continueSession)}`, "toggle:continue"), button(`${t(lang, "cliopts.newProject")}: ${onOff(settings.newProject)}`, "toggle:new-project")],
      [button(`${t(lang, "cliopts.output")}: ${settings.outputFormat}`, "menu:output"), button(`${t(lang, "cliopts.slash")}: ${onOff(!settings.disableSlashCommands)}`, "toggle:disable-slash")],
      [button(`${t(lang, "cliopts.addDir")}${settings.addDirs?.length ? ` (${settings.addDirs.length})` : ""}`, "cli:add-dir"), button(t(lang, "cliopts.jsonSchema"), "cli:json-schema")],
      [button(t(lang, "cliopts.logFile"), "cli:log-file"), button(`${t(lang, "cliopts.printTimeout")}${settings.printTimeout ? ` (${settings.printTimeout})` : ""}`, "cli:print-timeout")],
      [button(t(lang, "cliopts.conversation"), "cli:conversation"), button(t(lang, "cliopts.promptFlags"), "cli:prompt")],
      [button(t(lang, "common.back"), "menu:clitools")],
    ],
  };
}

export function outputFormatKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const settings = settingsFor(context, chatId);
  const lang = resolveLang(settings, context, chatId);
  const selected = settings.outputFormat;
  return {
    inline_keyboard: [
      ["text", "json", "stream-json"].map((value) => button(`${selected === value ? "✅ " : ""}${value}`, `set:output:${value}`)),
      [button(t(lang, "common.back"), "menu:cli")],
    ],
  };
}

export function sttKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const settings = settingsFor(context, chatId);
  const lang = resolveLang(settings, context, chatId);
  const provider = settings.sttProvider || context.config.stt.provider;
  const whisperModel = settings.sttWhisperModel || context.config.stt.whisperModel;
  const sttLang = settings.sttLang || context.config.stt.language;

  const rows: InlineKeyboardMarkup["inline_keyboard"] = [
    [button(`🎙️ Provider: ${provider}`, "menu:stt:provider")],
  ];

  if (provider === "whisper-local") {
    rows.push([
      button(`🧠 Whisper: ${whisperModel}`, "menu:stt:whisper"),
      button(`🌐 Lang: ${sttLang}`, "menu:stt:lang"),
    ]);
  } else if (provider !== "none") {
    rows.push([button(`🌐 Lang: ${sttLang}`, "menu:stt:lang")]);
  }

  rows.push([button(t(lang, "common.back"), "menu:main")]);
  return { inline_keyboard: rows };
}

export function sttProviderKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const settings = settingsFor(context, chatId);
  const lang = resolveLang(settings, context, chatId);
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
  rows.push([button(t(lang, "common.back"), "menu:stt")]);
  return { inline_keyboard: rows };
}

export function sttWhisperModelKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const settings = settingsFor(context, chatId);
  const lang = resolveLang(settings, context, chatId);
  const selected = settings.sttWhisperModel || context.config.stt.whisperModel;
  const choices = ["tiny", "base", "small", "medium"];
  const rows = choices.map((choice) => [
    button(`${choice === selected ? "✅ " : ""}${choice}`, `set:stt:whisper:${choice}`),
  ]);
  rows.push([button(t(lang, "common.back"), "menu:stt")]);
  return { inline_keyboard: rows };
}

export function sttLangKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const settings = settingsFor(context, chatId);
  const lang = resolveLang(settings, context, chatId);
  const selected = settings.sttLang || context.config.stt.language || "auto";
  const choices = [
    { label: lang === "zh" ? "自动检测 (Auto)" : "Auto-detect", id: "auto" },
    { label: lang === "zh" ? "中文 (Chinese)" : "Chinese", id: "zh" },
    { label: lang === "zh" ? "英语 (English)" : "English", id: "en" },
    { label: lang === "zh" ? "德语 (German)" : "German", id: "de" },
    { label: lang === "zh" ? "法语 (French)" : "French", id: "fr" },
    { label: lang === "zh" ? "西班牙语 (Spanish)" : "Spanish", id: "es" },
  ];
  const rows = choices.map((choice) => [
    button(`${choice.id === selected ? "✅ " : ""}${choice.label} (${choice.id})`, `set:stt:lang:${choice.id}`),
  ]);
  rows.push([button(t(lang, "common.back"), "menu:stt")]);
  return { inline_keyboard: rows };
}

export function ttsKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const settings = settingsFor(context, chatId);
  const lang = resolveLang(settings, context, chatId);
  const mode = settings.ttsMode || context.config.tts?.mode || "off";
  const voice = settings.ttsVoice || context.config.tts?.voice || "en-US-AndrewMultilingualNeural";
  const displayVoice = voice.replace(/^(en-US-|en-GB-|de-DE-|zh-CN-)/, "").replace("Neural", "");

  return {
    inline_keyboard: [
      [button(`🔊 ${lang === "zh" ? "模式" : "Mode"}: ${mode}`, "menu:tts:mode")],
      [button(`🗣️ ${lang === "zh" ? "音色" : "Voice"}: ${displayVoice}`, "menu:tts:voice")],
      [button(t(lang, "common.back"), "menu:main")],
    ],
  };
}

export function ttsModeKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const settings = settingsFor(context, chatId);
  const lang = resolveLang(settings, context, chatId);
  const selected = settings.ttsMode || context.config.tts?.mode || "off";
  const choices: Array<"off" | "voice-only" | "voice-and-text" | "auto"> = ["off", "voice-only", "voice-and-text", "auto"];
  const rows = choices.map((choice) => [
    button(`${choice === selected ? "✅ " : ""}${choice}`, `set:tts:mode:${choice}`),
  ]);
  rows.push([button(t(lang, "common.back"), "menu:tts")]);
  return { inline_keyboard: rows };
}

export function ttsVoiceKeyboard(context: AppContext, chatId: ChatId): InlineKeyboardMarkup {
  const settings = settingsFor(context, chatId);
  const lang = resolveLang(settings, context, chatId);
  const selected = settings.ttsVoice || context.config.tts?.voice || "en-US-AndrewMultilingualNeural";
  const choices = [
    { label: "Andrew (English - US, Multilingual Male)", id: "en-US-AndrewMultilingualNeural" },
    { label: "Ava (English - US, Multilingual Female)", id: "en-US-AvaMultilingualNeural" },
    { label: "Brian (English - US, Multilingual Male)", id: "en-US-BrianMultilingualNeural" },
    { label: "Emma (English - US, Multilingual Female)", id: "en-US-EmmaMultilingualNeural" },
    { label: "Xiaoxiao (中文 - 普通话女声)", id: "zh-CN-XiaoxiaoNeural" },
    { label: "Yunxi (中文 - 普通话男声)", id: "zh-CN-YunxiNeural" },
    { label: "Sonia (English - UK Female)", id: "en-GB-SoniaNeural" },
    { label: "Ryan (English - UK Male)", id: "en-GB-RyanNeural" },
    { label: "Florian (German Multilingual Male)", id: "de-DE-FlorianMultilingualNeural" },
    { label: "Seraphina (German Multilingual Female)", id: "de-DE-SeraphinaMultilingualNeural" },
  ];
  const rows = choices.map((choice) => [
    button(`${choice.id === selected ? "✅ " : ""}${choice.label}`, `set:tts:voice:${choice.id}`),
  ]);
  rows.push([button(t(lang, "common.back"), "menu:tts")]);
  return { inline_keyboard: rows };
}
