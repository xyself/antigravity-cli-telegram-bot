import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { listAvailableWorkspaces, readWorkspaceGitBadge } from "../src/domain/workspace.js";
import { formatEnvDoctorHtml, inspectEnvironment } from "../src/infra/env-doctor.js";
import { parseCallbackAction, serializeCallbackData } from "../src/router/callback-parser.js";
import { handleCallback } from "../src/router/callbacks.js";
import { handleCommand } from "../src/router/commands.js";
import { handleUpdate } from "../src/router/updates.js";
import {
  cliToolsKeyboard,
  inFlightProgressKeyboard,
  postTurnActionKeyboard,
  workspaceKeyboard,
} from "../src/ui/inline-keyboards.js";
import { handleDiffCommand } from "../src/usecases/diff-command.js";
import {
  formatWorkspaceGitSummaryHtml,
  getWorkspaceGitSummary,
  handleGitCommit,
  handleGitRevertAsk,
  handleGitRevertConfirm,
  validateGitCloneUrl,
} from "../src/usecases/git-actions.js";
import { asAppContext, callbackUpdate, createHarness, textUpdate } from "./helpers/fixtures.js";

function initGitRepo(dir: string): void {
  execFileSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Tester"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "tester@example.com"], { cwd: dir, stdio: "ignore" });
  fs.writeFileSync(path.join(dir, "README.md"), "# Demo\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: dir, stdio: "ignore" });
}

test("callback parser supports all new cockpit actions", () => {
  const actions = [
    "action:diff",
    "action:approve-plan",
    "action:btw-inline",
    "action:git-commit",
    "action:git-revert-ask",
    "action:git-revert-confirm",
  ];
  for (const raw of actions) {
    const parsed = parseCallbackAction(raw);
    assert.ok(parsed, `Expected ${raw} to parse`);
    assert.equal(serializeCallbackData(parsed!), raw);
  }
});

test("postTurnActionKeyboard renders contextual buttons for plan mode, dirty git workspace, and high context", () => {
  const planKb = postTurnActionKeyboard({
    mode: "plan",
    hasGitChanges: false,
    contextPct: 20,
    toolCalls: 1,
    lang: "zh",
  });
  assert.ok(planKb);
  const planFlat = planKb!.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(planFlat.includes("action:approve-plan"));
  assert.ok(planFlat.includes("cli:directive-grill-me"));

  const dirtyHighCtxKb = postTurnActionKeyboard({
    mode: "accept-edits",
    hasGitChanges: true,
    contextPct: 72,
    toolCalls: 3,
    lang: "zh",
  });
  assert.ok(dirtyHighCtxKb);
  assert.equal(dirtyHighCtxKb!.inline_keyboard.length, 2);
  const dirtyFlat = dirtyHighCtxKb!.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(dirtyFlat.includes("action:diff"));
  assert.ok(dirtyFlat.includes("action:git-commit"));
  assert.ok(dirtyFlat.includes("action:rewind"));
  assert.ok(dirtyFlat.includes("action:compact"));
  assert.ok(dirtyFlat.includes("action:fork"));

  const quietKb = postTurnActionKeyboard({
    mode: "accept-edits",
    hasGitChanges: false,
    contextPct: 15,
    toolCalls: 0,
    lang: "en",
  });
  assert.equal(quietKb, null);
});

test("inFlightProgressKeyboard includes Stop and Side Ask buttons", () => {
  const kb = inFlightProgressKeyboard("zh");
  const callbacks = kb.inline_keyboard.flat().map((b) => b.callback_data);
  assert.deepEqual(callbacks, ["action:cancel", "action:btw-inline"]);
});

test("approve-plan callback switches mode to accept-edits and enqueues execution prompt", async () => {
  const harness = createHarness();
  const ctx = asAppContext(harness);
  try {
    await ctx.state.setSession("777", {
      settings: { ...ctx.config.agy, mode: "plan", language: "zh" },
    } as never);

    await handleCallback(ctx, callbackUpdate("action:approve-plan", 777, 10));

    const updated = ctx.state.session("777");
    assert.equal(updated?.settings?.mode, "accept-edits");
    assert.equal(harness.capturedJobs.length, 1);
    assert.equal(harness.capturedJobs[0].kind, "prompt");
    assert.ok(harness.telegram.sentTexts().some((m) => m.includes("accept-edits")));
  } finally {
    harness.cleanup();
  }
});

test("btw-inline callback enables pendingBtw without cancelling active session", async () => {
  const harness = createHarness();
  const ctx = asAppContext(harness);
  try {
    await handleCallback(ctx, callbackUpdate("action:btw-inline", 777, 10));
    assert.equal(ctx.state.session("777")?.pendingBtw, true);
  } finally {
    harness.cleanup();
  }
});

test("env-doctor inspects environment and formats bilingual HTML report without touching STT/TTS", async () => {
  const harness = createHarness();
  const ctx = asAppContext(harness);
  try {
    const report = inspectEnvironment(ctx.config);
    assert.equal(report.agy.available, true);
    assert.equal(report.workspace.exists, true);
    assert.ok(report.nodeVersion.startsWith("v"));

    const htmlZh = formatEnvDoctorHtml(report, "zh");
    assert.ok(htmlZh.includes("环境健康诊断"));
    assert.ok(htmlZh.includes("AGY CLI"));
    assert.ok(htmlZh.includes("Git"));

    const htmlEn = formatEnvDoctorHtml(report, "en");
    assert.ok(htmlEn.includes("Environment Health Doctor"));

    // Verify /doctor slash command works
    await handleCommand(ctx, textUpdate(777, "/doctor").message!, "/doctor", []);
    assert.ok(harness.telegram.sentTexts().some((m) => m.includes("Doctor")));

    // Verify Env Doctor button exists in cliToolsKeyboard
    const toolsKb = cliToolsKeyboard(ctx, "777");
    assert.ok(toolsKb.inline_keyboard.flat().some((b) => b.callback_data === "menu:doctor"));
  } finally {
    harness.cleanup();
  }
});

test("validateGitCloneUrl accepts safe HTTPS/SSH URLs and rejects flag injection & traversal", () => {
  const https = validateGitCloneUrl("https://github.com/org/my-repo.git");
  assert.equal(https.valid, true);
  assert.equal(https.repoName, "my-repo");

  const ssh = validateGitCloneUrl("git@github.com:org/awesome_tool.git");
  assert.equal(ssh.valid, true);
  assert.equal(ssh.repoName, "awesome_tool");

  assert.equal(validateGitCloneUrl("--upload-pack=evil").valid, false);
  assert.equal(validateGitCloneUrl("https://github.com/org/repo; rm -rf /").valid, false);
  assert.equal(validateGitCloneUrl("file:///etc/passwd").valid, false);
  assert.equal(validateGitCloneUrl("https://github.com/org/..").valid, false);
});

test("workspace Git badge detection and workspaceKeyboard show branch, dirty count, and Clone button", () => {
  const harness = createHarness();
  const ctx = asAppContext(harness);
  try {
    const repoDir = path.join(ctx.config.agy.workspace, "demo-app");
    fs.mkdirSync(repoDir, { recursive: true });
    initGitRepo(repoDir);
    fs.writeFileSync(path.join(repoDir, "README.md"), "# Modified\n", "utf8");
    fs.writeFileSync(path.join(repoDir, "extra.ts"), "export const x = 1;\n", "utf8");

    const badge = readWorkspaceGitBadge(repoDir);
    assert.equal(badge.gitBranch, "main");
    assert.equal(badge.gitDirtyCount, 2);

    const list = listAvailableWorkspaces(ctx.config.agy.projectsRoot, ctx.config.agy.workspace);
    const demo = list.find((w) => w.name === "demo-app");
    assert.ok(demo);
    assert.equal(demo!.gitBranch, "main");
    assert.equal(demo!.gitDirtyCount, 2);

    const kb = workspaceKeyboard(ctx, "777", 0);
    const flat = kb.inline_keyboard.flat();
    assert.ok(flat.some((b) => b.text.includes("demo-app (main·2M)")));
    assert.ok(flat.some((b) => b.callback_data === "cli:git-clone"));
  } finally {
    harness.cleanup();
  }
});

test("Git summary, diff action bar, 1-tap commit via pendingInput, and 2-step revert work end-to-end", async () => {
  const harness = createHarness();
  const ctx = asAppContext(harness);
  try {
    const ws = ctx.config.agy.workspace;
    initGitRepo(ws);

    // 1. Modify a tracked file and check summary + diff action buttons
    fs.writeFileSync(path.join(ws, "README.md"), "# Updated content\n", "utf8");
    const summary = await getWorkspaceGitSummary(ws);
    assert.ok(summary);
    assert.equal(summary!.branch, "main");
    assert.equal(summary!.totalChanged, 1);
    assert.ok(formatWorkspaceGitSummaryHtml(summary!, "zh").includes("README.md"));

    await handleDiffCommand(ctx, "777");
    const diffPayload = harness.telegram.lastPayload("sendMessage");
    const diffMarkup = diffPayload?.reply_markup as { inline_keyboard?: Array<Array<{ callback_data?: string }>> } | undefined;
    const diffButtons = diffMarkup?.inline_keyboard?.flat().map((b) => b.callback_data) || [];
    assert.ok(diffButtons.includes("action:git-commit"));
    assert.ok(diffButtons.includes("action:git-revert-ask"));

    // 2. Trigger git-commit callback -> pendingInput -> user submits commit message
    await handleCallback(ctx, callbackUpdate("action:git-commit", 777, 50));
    assert.equal(ctx.state.session("777")?.pendingInput?.kind, "git-commit");

    await handleUpdate(ctx, textUpdate(777, "feat: update readme"));
    assert.equal(ctx.state.session("777")?.pendingInput, null);

    const afterCommit = await getWorkspaceGitSummary(ws);
    assert.equal(afterCommit?.totalChanged, 0);

    // 3. Modify again and perform 2-step revert
    fs.writeFileSync(path.join(ws, "README.md"), "# Dirty again\n", "utf8");
    fs.writeFileSync(path.join(ws, "untracked.txt"), "temp\n", "utf8");
    await handleGitRevertAsk(ctx, "777", 55);
    await handleGitRevertConfirm(ctx, "777", 55);

    const afterRevert = await getWorkspaceGitSummary(ws);
    assert.equal(afterRevert?.totalChanged, 0);
    assert.equal(fs.existsSync(path.join(ws, "untracked.txt")), false);

    // Direct call check for handleGitCommit with empty changes reports graceful error
    await handleGitCommit(ctx, "777", "nothing to commit");
    assert.ok(harness.telegram.sentTexts().some((m) => m.toLowerCase().includes("commit")));
  } finally {
    harness.cleanup();
  }
});

test("resolveBotGitRepoDir locates forked Git repository via BOT_REPO_DIR", async () => {
  const { resolveBotGitRepoDir } = await import("../src/usecases/self-update.js");
  const harness = createHarness();
  try {
    const forkDir = path.join(harness.config.agy.workspace, "my-fork");
    fs.mkdirSync(forkDir, { recursive: true });
    initGitRepo(forkDir);

    const found = await resolveBotGitRepoDir({ BOT_REPO_DIR: forkDir });
    assert.equal(found.repoDir, path.resolve(forkDir));
  } finally {
    harness.cleanup();
  }
});
