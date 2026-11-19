import { runAgyCommand } from "../agy-runner.js";
import type { AppContext } from "../context.js";
import { createMainKeyboard } from "../keyboards.js";
import { backKeyboard } from "../ui/inline-keyboards.js";
import { isZh, settingsFor } from "../domain/settings.js";
import { escapeHtml } from "../telegram.js";
import { reply, replyWithHtml } from "../ui/reply.js";
import type { ChatId } from "../types.js";

export interface McpServerItem {
  name: string;
  type: string;
  status: string;
  commandOrUrl: string;
}

export function sanitizeSecrets(text: string): string {
  return text
    .replace(/bot\d+:[A-Za-z0-9_-]{35,}/g, "[REDACTED_TELEGRAM_TOKEN]")
    .replace(/(?:api[_-]?key|secret|token|password|bearer)[=:\s]+["']?([A-Za-z0-9_-]{16,})["']?/gi, (match, secret) => match.replace(secret, "[REDACTED]"));
}

export function parseMcpList(rawOutput: string): McpServerItem[] {
  const lines = rawOutput.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) return [];
  const header = lines[0].toLowerCase();
  if (!header.includes("name") || !header.includes("status")) {
    return [];
  }
  const items: McpServerItem[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split(/\s+/);
    if (parts.length >= 3) {
      const name = parts[0];
      const type = parts[1];
      const status = parts[2];
      const commandOrUrl = parts.slice(3).join(" ");
      items.push({ name, type, status, commandOrUrl });
    }
  }
  return items;
}

export function formatMcpHtml(rawOutput: string, zh = false): string {
  const servers = parseMcpList(rawOutput);
  if (!servers.length) {
    if (rawOutput.trim().length === 0 || rawOutput.includes("NAME")) {
      return zh
        ? "🛠️ <b>AGY MCP 服务器</b>\n\n当前未配置任何 MCP 服务器。"
        : "🛠️ <b>AGY MCP Servers</b>\n\nNo configured MCP servers.";
    }
    const title = zh ? "🛠️ <b>AGY MCP 服务器</b>\n\n" : "🛠️ <b>AGY MCP Servers</b>\n\n";
    return `${title}<pre>${escapeHtml(sanitizeSecrets(rawOutput))}</pre>`;
  }

  const header = zh
    ? `🛠️ <b>已配置的 MCP 服务器（共 ${servers.length} 个）</b>\n\n`
    : `🛠️ <b>Configured MCP Servers (${servers.length})</b>\n\n`;
  const list = servers.map((s) => {
    const statusLower = s.status.toLowerCase();
    const isEnabled = statusLower === "enabled";
    const statusIcon = isEnabled ? "🟢" : "🔴";
    const statusLabel = zh ? (isEnabled ? "已启用" : "已禁用") : s.status;
    const statusText = `<i>${escapeHtml(statusLabel)}</i>`;
    const cleanDetails = sanitizeSecrets(s.commandOrUrl);
    const details = cleanDetails ? `\n  <code>${escapeHtml(cleanDetails)}</code>` : "";
    return `• <b>${escapeHtml(s.name)}</b> (${escapeHtml(s.type)}) — ${statusIcon} ${statusText}${details}`;
  }).join("\n\n");

  return `${header}${list}`;
}

export async function handleMcpCommand(context: AppContext, chatId: ChatId, messageId?: number): Promise<void> {
  const settings = settingsFor(context, chatId);
  const zh = isZh(settings, context, chatId);
  const workspacePath = settings.workspace || context.config.agy.workspace;
  const effectiveAgyConfig = workspacePath === context.config.agy.workspace
    ? context.config.agy
    : { ...context.config.agy, workspace: workspacePath };

  try {
    const output = await runAgyCommand(effectiveAgyConfig, ["mcp", "list"], context.config.agy.timeoutMs);
    const html = formatMcpHtml(output, zh);
    if (messageId) {
      try {
        await context.telegram.editMessageText(chatId, messageId, html, backKeyboard(zh), "HTML");
      } catch {
        await context.telegram.editMessageText(chatId, messageId, html.replace(/<[^>]+>/g, ""), backKeyboard(zh)).catch(() => undefined);
      }
    } else {
      await replyWithHtml(context, chatId, html, createMainKeyboard(settingsFor(context, chatId)));
    }
  } catch (error) {
    const errorPrefix = zh ? "无法读取 AGY MCP 服务列表: " : "Could not read AGY MCP servers: ";
    const errorText = `${errorPrefix}${(error as Error).message}`;
    if (messageId) {
      await context.telegram.editMessageText(chatId, messageId, errorText, backKeyboard(zh)).catch(() => undefined);
    } else {
      await reply(context, chatId, errorText, createMainKeyboard(settingsFor(context, chatId)));
    }
  }
}
