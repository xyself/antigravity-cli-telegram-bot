import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { AppContext } from "../context.js";
import { isZh, settingsFor } from "../domain/settings.js";
import { createMainKeyboard } from "../keyboards.js";
import { escapeHtml } from "../telegram.js";
import type { ChatId } from "../types.js";
import { reply, replyWithHtml } from "../ui/reply.js";

const execFileAsync = promisify(execFile);

export function resolveAgyDataDir(): string {
  const home = os.homedir() || process.env.HOME || "/home/ubuntu";
  const candidates = [
    path.join(home, ".gemini/antigravity-cli"),
    "/home/ubuntu/.gemini/antigravity-cli",
    "/root/.gemini/antigravity-cli",
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

export function resolveGeminiRootDir(): string {
  const home = os.homedir() || process.env.HOME || "/home/ubuntu";
  const candidates = [
    path.join(home, ".gemini"),
    "/home/ubuntu/.gemini",
    "/root/.gemini",
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.dirname(resolveAgyDataDir());
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export async function handleBackupCommand(context: AppContext, chatId: ChatId): Promise<void> {
  const settings = settingsFor(context, chatId);
  const zh = isZh(settings, context, chatId);

  const geminiDir = resolveGeminiRootDir();
  const agyDataDir = resolveAgyDataDir();

  const useGeminiRoot = fs.existsSync(geminiDir);
  const baseDir = useGeminiRoot ? geminiDir : agyDataDir;

  if (!fs.existsSync(baseDir)) {
    const errorMsg = zh
      ? `❌ 未找到 AGY 数据目录：<code>${escapeHtml(baseDir)}</code>`
      : `❌ AGY data directory not found: <code>${escapeHtml(baseDir)}</code>`;
    await replyWithHtml(context, chatId, errorMsg, createMainKeyboard(settings));
    return;
  }

  // 1. Send packing notification
  const initialMsg = zh
    ? "📦 正在打包 AGY 对话、工件与 MCP 配置数据，请稍候..."
    : "📦 Packaging AGY conversations, artifacts, and MCP configs, please wait...";
  await reply(context, chatId, initialMsg);

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const archiveFilename = `agy_backup_${timestamp}.tar.gz`;

  const tmpDir = context.config.tempDir || os.tmpdir();
  await fs.promises.mkdir(tmpDir, { recursive: true });
  const archivePath = path.join(tmpDir, archiveFilename);

  // 2. Identify items to include in tar
  const itemsToInclude: string[] = [];
  const candidateItems = useGeminiRoot
    ? [
        "antigravity-cli/conversations",
        "antigravity-cli/brain",
        "antigravity-cli/conversation_summaries.db",
        "antigravity-cli/conversation_summaries.db-wal",
        "antigravity-cli/conversation_summaries.db-shm",
        "antigravity-cli/settings.json",
        "config/mcp_config.json",
        "config/AGENTS.md",
        "config/GEMINI.md",
        "config/projects",
        "config/config.json",
        "config/plugins.json",
        "config/skills.json",
        "skills",
        "plugins",
        "hooks.json",
      ]
    : [
        "conversations",
        "brain",
        "conversation_summaries.db",
        "conversation_summaries.db-wal",
        "conversation_summaries.db-shm",
        "settings.json",
      ];

  for (const item of candidateItems) {
    if (fs.existsSync(path.join(baseDir, item))) {
      itemsToInclude.push(item);
    }
  }

  if (itemsToInclude.length === 0) {
    const emptyMsg = zh
      ? "⚠️ 没有找到可备份的对话、工件或配置文件。"
      : "⚠️ No conversation, artifact, or configuration files found to back up.";
    await reply(context, chatId, emptyMsg, createMainKeyboard(settings));
    return;
  }

  try {
    // 3. Create compressed tar archive
    try {
      await execFileAsync("tar", ["--warning=no-file-changed", "-czf", archivePath, "-C", baseDir, ...itemsToInclude], {
        timeout: 60_000,
      });
    } catch (err: unknown) {
      // If tar exited with code 1 due to active WAL file read change, check if archive was created
      const fileStat = await fs.promises.stat(archivePath).catch(() => null);
      if (!fileStat || fileStat.size === 0) {
        throw err;
      }
    }

    const stat = await fs.promises.stat(archivePath);
    const sizeStr = formatBytes(stat.size);

    // 4. Send document to Telegram
    const timeFormatted = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    const summaryList: string[] = [];
    if (itemsToInclude.some((i) => i.includes("conversations"))) summaryList.push(zh ? "会话记录" : "Conversations");
    if (itemsToInclude.some((i) => i.includes("brain"))) summaryList.push(zh ? "思考工件" : "Brain");
    if (itemsToInclude.some((i) => i.includes("mcp_config.json"))) summaryList.push(zh ? "MCP配置" : "MCP Config");
    if (itemsToInclude.some((i) => i.includes("AGENTS.md") || i.includes("GEMINI.md"))) summaryList.push(zh ? "全局规则" : "Global Rules");
    if (itemsToInclude.some((i) => i.includes("projects"))) summaryList.push(zh ? "项目配置" : "Projects");
    if (itemsToInclude.some((i) => i.includes("skills"))) summaryList.push(zh ? "自定义技能" : "Skills");
    if (itemsToInclude.some((i) => i.includes("plugins"))) summaryList.push(zh ? "插件" : "Plugins");
    if (itemsToInclude.some((i) => i.includes("settings.json"))) summaryList.push(zh ? "CLI设置" : "CLI Settings");

    const includedSummary = summaryList.length > 0 ? summaryList.join("、") : itemsToInclude.join(", ");

    const restoreHint = useGeminiRoot
      ? (zh ? "解压覆盖至 ~/.gemini 目录即可完整恢复（含对话、工件、MCP 工具配置与规则）。" : "Extract into ~/.gemini to restore (including conversations, artifacts, MCP configs, and rules).")
      : (zh ? "解压覆盖至 ~/.gemini/antigravity-cli 即可完整恢复。" : "Extract into ~/.gemini/antigravity-cli to restore.");

    const caption = zh
      ? `✅ <b>AGY 全量备份已完成</b>\n\n📅 时间: <code>${timeFormatted}</code>\n📦 大小: <code>${sizeStr}</code>\n📂 包含: ${includedSummary}\n\n💡 <i>${restoreHint}</i>`
      : `✅ <b>AGY Full Backup Completed</b>\n\n📅 Date: <code>${timeFormatted}</code>\n📦 Size: <code>${sizeStr}</code>\n📂 Includes: ${includedSummary}\n\n💡 <i>${restoreHint}</i>`;

    await context.telegram.sendDocumentFile(
      chatId,
      archivePath,
      caption,
      createMainKeyboard(settings)
    );
  } catch (err: unknown) {
    const error = err as Error;
    const failMsg = zh
      ? `❌ 打包或发送备份文件失败：${escapeHtml(error.message || String(error))}`
      : `❌ Failed to package or send backup: ${escapeHtml(error.message || String(error))}`;
    await replyWithHtml(context, chatId, failMsg, createMainKeyboard(settings));
  } finally {
    // 5. Clean up temporary archive file
    await fs.promises.unlink(archivePath).catch(() => undefined);
  }
}
