import test from "node:test";
import assert from "node:assert/strict";
import { en } from "../src/i18n/en.js";
import { zh } from "../src/i18n/zh.js";
import { resolveLang, t, type I18nKey } from "../src/i18n/index.js";
import {
  getActiveEfforts,
  getActiveModes,
  getDiscoveredSubcommands,
  parseCliHelp,
  resetCliCapabilities,
  setActiveEfforts,
  setActiveModes,
  setDiscoveredSubcommands,
} from "../src/cli-capabilities.js";
import { validateCustomArgs } from "../src/agy-runner.js";
import { isEffort, isMode } from "../src/config.js";
import {
  cliOptionsKeyboard,
  cliToolsKeyboard,
  effortKeyboard,
  menuProfileKeyboard,
  modeKeyboard,
  modelKeyboard,
  voiceSettingsKeyboard,
  workspaceKeyboard,
} from "../src/ui/inline-keyboards.js";
import { BOT_COMMANDS, BOT_COMMANDS_ZH } from "../src/bot.js";
import { registeredCommands } from "../src/router/commands.js";
import { handleCallback } from "../src/router/callbacks.js";
import { handleUpdate } from "../src/router/updates.js";
import { asAppContext, callbackUpdate, createHarness, textUpdate } from "./helpers/fixtures.js";

test("i18n: en and zh dictionaries have 100% key parity and interpolation support", () => {
  const enKeys = Object.keys(en).sort();
  const zhKeys = Object.keys(zh).sort();
  assert.deepEqual(enKeys, zhKeys, "en and zh dictionaries must share identical keys");

  for (const key of enKeys as I18nKey[]) {
    assert.ok(en[key].length > 0, `en[${key}] must be non-empty`);
    assert.ok(zh[key].length > 0, `zh[${key}] must be non-empty`);
  }

  assert.equal(t("en", "effort.set", { value: "xhigh" }), "Effort set to xhigh.");
  assert.equal(t("zh", "effort.set", { value: "xhigh" }), "思考深度已设置为 xhigh。");
  assert.equal(resolveLang({ language: "zh" }), "zh");
  assert.equal(resolveLang({ language: "en" }), "en");
});

test("i18n: dynamic session language switch updates all inline keyboards without process.env leak", async () => {
  const harness = createHarness();
  const ctx = asAppContext(harness);
  const chatId = 777;
  try {
    // Switch session to Chinese via callback
    await handleCallback(ctx, callbackUpdate("set:lang:zh", chatId, 10));
    assert.equal(ctx.state.session(chatId)?.settings?.language, "zh");

    const wsKb = workspaceKeyboard(ctx, chatId, 0);
    const wsTexts = wsKb.inline_keyboard.flat().map((b) => b.text);
    assert.ok(wsTexts.includes("‹ 返回"), "workspaceKeyboard must respect session zh language");

    const profKb = menuProfileKeyboard("mixed", "zh");
    const profTexts = profKb.inline_keyboard.flat().map((b) => b.text);
    assert.ok(profTexts.some((txt) => txt.includes("均衡")), "menuProfileKeyboard must render Chinese labels");

    const voiceKb = voiceSettingsKeyboard(ctx, chatId);
    const voiceTexts = voiceKb.inline_keyboard.flat().map((b) => b.text);
    assert.ok(voiceTexts.includes("‹ 返回"), "voiceSettingsKeyboard must render Chinese back button");

    const toolsKb = cliToolsKeyboard(ctx, chatId);
    const toolsTexts = toolsKb.inline_keyboard.flat().map((b) => b.text);
    assert.ok(toolsTexts.includes("🔍 CLI 自检与同步"), "cliToolsKeyboard must include localized CLI check button");
  } finally {
    harness.cleanup();
  }
});

test("cli-capabilities: dynamic efforts, modes, and subcommands decouple Bot from CLI updates", () => {
  const harness = createHarness();
  const ctx = asAppContext(harness);
  try {
    resetCliCapabilities();

    const parsed = parseCliHelp(`Usage of agy:
  --effort   Reasoning effort (low|medium|high|xhigh|max|ultra)
  --mode     Execution mode (accept-edits, auto, plan, autonomous)

Available subcommands:
  models          List available models
  remote-control  Manage remote control daemon
  doctor          Diagnose environment
`);
    assert.ok(parsed.effort.includes("ultra"));
    assert.ok(parsed.modes.includes("autonomous"));
    assert.ok(parsed.subcommands.includes("doctor"));

    setActiveEfforts(["low", "medium", "high", "xhigh", "max", "ultra"]);
    setActiveModes(["plan", "accept-edits", "auto", "autonomous"]);
    setDiscoveredSubcommands(parsed.subcommands);

    assert.equal(isEffort("ultra"), true, "isEffort accepts newly discovered CLI effort");
    assert.equal(isMode("autonomous"), true, "isMode accepts newly discovered CLI mode");
    assert.equal(validateCustomArgs(["doctor", "--check"]), null, "validateCustomArgs allows newly discovered CLI subcommands");
    assert.ok(getDiscoveredSubcommands().includes("doctor"));

    const effButtons = effortKeyboard(ctx, 777).inline_keyboard.flat().map((b) => b.callback_data);
    assert.ok(effButtons.includes("set:effort:xhigh"));
    assert.ok(effButtons.includes("set:effort:max"));
    assert.ok(effButtons.includes("set:effort:ultra"));

    const modeButtons = modeKeyboard(ctx, 777).inline_keyboard.flat().map((b) => b.callback_data);
    assert.ok(modeButtons.includes("set:mode:auto"));
    assert.ok(modeButtons.includes("set:mode:autonomous"));
  } finally {
    resetCliCapabilities();
    harness.cleanup();
  }
});

test("interactive pendingInput flow configures CLI options and supports clear/cancel", async () => {
  const harness = createHarness();
  const ctx = asAppContext(harness);
  const chatId = 777;
  try {
    // 1. Tap cli:project -> sets pendingInput: project
    await handleCallback(ctx, callbackUpdate("cli:project", chatId, 50));
    assert.equal(ctx.state.session(chatId)?.pendingInput?.kind, "project");

    // 2. Send text message -> saves project setting instead of running prompt
    await handleUpdate(ctx, textUpdate(chatId, "my-cloud-project"));
    assert.equal(ctx.state.session(chatId)?.pendingInput, null);
    assert.equal(ctx.state.session(chatId)?.settings?.project, "my-cloud-project");
    assert.equal(harness.capturedJobs.length, 0, "pendingInput reply must not enqueue a prompt job");

    // 3. Clear project via input:clear:project callback
    await handleCallback(ctx, callbackUpdate("input:clear:project", chatId, 51));
    assert.equal(ctx.state.session(chatId)?.settings?.project, null);

    // 4. Tap cli:agent then cancel via input:cancel
    await handleCallback(ctx, callbackUpdate("cli:agent", chatId, 52));
    assert.equal(ctx.state.session(chatId)?.pendingInput?.kind, "agent");
    await handleCallback(ctx, callbackUpdate("input:cancel", chatId, 52));
    assert.equal(ctx.state.session(chatId)?.pendingInput, null);

    const optsKb = cliOptionsKeyboard(ctx, chatId);
    assert.ok(optsKb.inline_keyboard.length >= 6);
  } finally {
    harness.cleanup();
  }
});

test("command surface: BOT_COMMANDS is streamlined to 16 core commands while keeping all legacy handlers", () => {
  assert.equal(BOT_COMMANDS.length, 16);
  assert.equal(BOT_COMMANDS_ZH.length, 16);
  assert.deepEqual(
    BOT_COMMANDS.map((c) => c.command),
    BOT_COMMANDS_ZH.map((c) => c.command),
    "EN and ZH command popup lists must have identical command order",
  );
  // Legacy commands remain registered for backward compatibility
  const reg = registeredCommands();
  for (const legacy of ["/add-dir", "/json-schema", "/log-file", "/print-timeout", "/cli-check", "/remote-control"]) {
    assert.ok(reg.includes(legacy), `legacy command ${legacy} must remain registered`);
  }
});

test("interactive guide, 1-tap directives launcher, plugin/mcp interactive controls, and auto-generated subcommand buttons", async () => {
  const harness = createHarness();
  const ctx = asAppContext(harness);
  const chatId = 777;
  try {
    resetCliCapabilities();

    // 1. Interactive Playbook & What's New Guide (4 tabs)
    await handleCallback(ctx, callbackUpdate("menu:guide", chatId, 60));
    assert.match(String(harness.telegram.editedTexts().at(-1)), /<b>🔥 AGY CLI New Features & How to Play<\/b>/);

    await handleCallback(ctx, callbackUpdate("menu:guide:directives", chatId, 60));
    assert.match(String(harness.telegram.editedTexts().at(-1)), /<b>⚡ Native AGY Power Directives \(1-Tap Launch\)<\/b>/);

    await handleCallback(ctx, callbackUpdate("menu:guide:session", chatId, 60));
    assert.match(String(harness.telegram.editedTexts().at(-1)), /<b>🌿 Session Time-Travel & Context Magic<\/b>/);

    await handleCallback(ctx, callbackUpdate("menu:guide:tools", chatId, 60));
    assert.match(String(harness.telegram.editedTexts().at(-1)), /<b>🧩 Skills, MCP, Plugins & Multi-Modal Input<\/b>/);

    // 2. 1-Tap Native Power Directives Launcher -> sets pendingInput -> next message enqueues /plan prompt
    await handleCallback(ctx, callbackUpdate("menu:directives", chatId, 61));
    assert.match(String(harness.telegram.editedTexts().at(-1)), /<b>⚡ AGY Power Directives Launcher<\/b>/);

    await handleCallback(ctx, callbackUpdate("cli:directive-plan", chatId, 61));
    assert.equal(ctx.state.session(chatId)?.pendingInput?.kind, "directive-plan");

    await handleUpdate(ctx, textUpdate(chatId, "Design a fault-tolerant payment queue"));
    assert.equal(ctx.state.session(chatId)?.pendingInput, null);
    assert.equal(harness.capturedJobs.length, 1);
    assert.equal(harness.capturedJobs[0].kind, "prompt");
    assert.equal(harness.capturedJobs[0].prompt, "/plan Design a fault-tolerant payment queue");
    harness.capturedJobs[0].resolve();
    await new Promise((r) => setTimeout(r, 10));

    // 3. 1-Tap Distill Skills from Current Chat (action:learn-now)
    await handleCallback(ctx, callbackUpdate("action:learn-now", chatId, 61));
    assert.equal(harness.capturedJobs.length, 2);
    assert.match(String(harness.capturedJobs[1].prompt), /^\/learn /);
    harness.capturedJobs[1].resolve();

    // 4. Interactive Plugin & MCP Manager -> triggers runCustomAgy confirmation
    await handleCallback(ctx, callbackUpdate("cli:plugin-install", chatId, 62));
    assert.equal(ctx.state.session(chatId)?.pendingInput?.kind, "plugin-install");
    await handleUpdate(ctx, textUpdate(chatId, "my-awesome-plugin"));
    assert.deepEqual(harness.pendingDangerousCommands.get(String(chatId)), ["plugin", "install", "my-awesome-plugin"]);

    // 5. Auto-generated button in cliToolsKeyboard when CLI capabilities discovers a brand-new subcommand
    setDiscoveredSubcommands(["models", "benchmark"]);
    const toolsKb = cliToolsKeyboard(ctx, chatId);
    const allCallbacks = toolsKb.inline_keyboard.flat().map((b) => b.callback_data);
    assert.ok(allCallbacks.includes("cli:sub:benchmark"), "cliToolsKeyboard must auto-render button for newly discovered CLI subcommand");

    await handleCallback(ctx, callbackUpdate("cli:sub:benchmark", chatId, 63));
    assert.ok(
      harness.telegram.sentTexts().some((txt) => txt.includes("Running agy benchmark...")),
      "tapping cli:sub:benchmark must execute agy benchmark directly as a top-level subcommand",
    );

    // 6. AGY CLI-style model family grouping & two-way effort linkage
    const modelKb = modelKeyboard(ctx, chatId, 0);
    const modelCallbacks = modelKb.inline_keyboard.flat().map((b) => b.callback_data);
    assert.ok(modelCallbacks.includes("set:model:gemini-4-hydrogen"), "model picker groups variants into clean base model families");
    assert.ok(modelCallbacks.includes("set:model:gemini-4-carbon"));
    assert.ok(modelCallbacks.includes("set:model:gemini-3.8-flash"));

    // Selecting base family "gemini-4-hydrogen" resolves to current effort ("high" by default -> "gemini-4-hydrogen-high")
    await handleCallback(ctx, callbackUpdate("set:model:gemini-4-hydrogen", chatId, 64));
    assert.equal(ctx.state.session(chatId)?.settings?.model, "gemini-4-hydrogen-high");
    assert.equal(ctx.state.session(chatId)?.settings?.effort, "high");

    // Switching effort via set:effort:xhigh automatically updates the active model variant to gemini-4-hydrogen-xhigh!
    await handleCallback(ctx, callbackUpdate("set:effort:xhigh", chatId, 64));
    assert.equal(ctx.state.session(chatId)?.settings?.effort, "xhigh");
    assert.equal(
      ctx.state.session(chatId)?.settings?.model,
      "gemini-4-hydrogen-xhigh",
      "changing /effort must automatically switch the active model variant in the same family",
    );
  } finally {
    resetCliCapabilities();
    harness.cleanup();
  }
});

