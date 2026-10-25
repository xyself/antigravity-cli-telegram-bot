import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { formatBytes, handleBackupCommand, resolveAgyDataDir, resolveGeminiRootDir } from "../src/usecases/backup-command.js";
import { asAppContext, createHarness } from "./helpers/fixtures.js";

test("formatBytes formats byte sizes accurately", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(500), "500.0 B");
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(1024 * 1024 * 3.5), "3.5 MB");
});

test("resolveAgyDataDir returns an existing or fallback directory", () => {
  const dir = resolveAgyDataDir();
  assert.ok(typeof dir === "string" && dir.length > 0);
  assert.ok(dir.includes(".gemini/antigravity-cli"));
});

test("resolveGeminiRootDir returns an existing or fallback directory", () => {
  const dir = resolveGeminiRootDir();
  assert.ok(typeof dir === "string" && dir.length > 0);
  assert.ok(dir.includes(".gemini"));
});

test("handleBackupCommand packages agy data and sends document file", async () => {
  const harness = createHarness();
  const context = asAppContext(harness);
  const chatId = 123456;

  try {
    await handleBackupCommand(context, chatId);

    // Verify messages
    const sent = harness.telegram.sentTexts();
    assert.ok(sent.some((t) => t.includes("正在打包") || t.includes("Packaging AGY")));

    // Verify document was uploaded
    const docPayload = harness.telegram.lastPayload("sendDocumentFile");
    assert.ok(docPayload, "sendDocumentFile should have been called");
    assert.equal(docPayload.chat_id, chatId);
    assert.ok(String(docPayload.caption).includes("AGY"));
    assert.ok(String(docPayload.caption).includes("MCP"));
    assert.ok(String(docPayload.caption).includes("Command History") || String(docPayload.caption).includes("历史指令"));

    // Verify temp archive was cleaned up
    const filePath = String(docPayload.file_path);
    assert.equal(fs.existsSync(filePath), false, "Temporary archive file must be unlinked");
  } finally {
    harness.cleanup();
  }
});
