import test from "node:test";
import assert from "node:assert/strict";
import { handleCallback } from "../src/router/callbacks.js";
import { asAppContext, callbackUpdate, createHarness } from "./helpers/fixtures.js";
import { BOT_COMMANDS, BOT_COMMANDS_ZH } from "../src/bot.js";

test("language switch to English explicitly sets BOT_COMMANDS with chat scope", async () => {
  const harness = createHarness();
  const context = asAppContext(harness);
  const chatId = 888999;
  const messageId = 101;

  // Simulate callback setting language to English
  const cb = callbackUpdate("set:lang:en", chatId, messageId);
  await handleCallback(context, cb);

  // Check that setMyCommands was called with BOT_COMMANDS
  const setCommandsCall = harness.telegram.calls.find(
    (c) => c.method === "setMyCommands" && (c.payload.scope as { chat_id?: number })?.chat_id === chatId
  );
  assert.ok(setCommandsCall, "setMyCommands must be called for the chat scope");
  assert.deepEqual(setCommandsCall.payload.commands, BOT_COMMANDS);

  // Assert deleteMyCommands was NOT called
  const deleteCommandsCall = harness.telegram.calls.find((c) => c.method === "deleteMyCommands");
  assert.equal(deleteCommandsCall, undefined, "deleteMyCommands must not be called when switching to English");

  harness.cleanup();
});

test("language switch to Chinese explicitly sets BOT_COMMANDS_ZH with chat scope", async () => {
  const harness = createHarness();
  const context = asAppContext(harness);
  const chatId = 888999;
  const messageId = 102;

  // Simulate callback setting language to Chinese
  const cb = callbackUpdate("set:lang:zh", chatId, messageId);
  await handleCallback(context, cb);

  // Check that setMyCommands was called with BOT_COMMANDS_ZH
  const setCommandsCall = harness.telegram.calls.find(
    (c) => c.method === "setMyCommands" && (c.payload.scope as { chat_id?: number })?.chat_id === chatId
  );
  assert.ok(setCommandsCall, "setMyCommands must be called for the chat scope");
  assert.deepEqual(setCommandsCall.payload.commands, BOT_COMMANDS_ZH);

  harness.cleanup();
});
