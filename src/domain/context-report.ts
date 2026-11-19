/**
 * `/context` report: pure extraction, rendering, and lightweight metrics.
 *
 * `extractContext`/`renderContext` drive the human-readable Active Context
 * panel. `parseContextMetrics` is a separate, deliberately forgiving extractor
 * used for telemetry (it never throws — it returns whatever it can find).
 */
import { cleanAnsi, parseTokenValue } from "./report-text.js";

export interface ContextReport {
  modelLine: string | null;
  usageLine: string | null;
  categories: string[];
  freeLine: string | null;
  checkpointLine: string | null;
  checkpointDetail: string | null;
  artifactsCount: number;
}

export interface ContextMetrics {
  tokens?: string;
  percentage?: number;
  currentTokens?: number;
  maxTokens?: number;
}

/** Extract an {@link ContextReport}. Throws when no Context Usage panel exists. */
export function extractContext(rawOutput: string, cleaned?: string): ContextReport {
  const text = (cleaned ?? cleanAnsi(rawOutput)).trim();
  // The TUI autocomplete list can mention /context before the actual panel.
  // The final Context Usage occurrence is the rendered command result.
  const contextMatches = [...text.matchAll(/(?:└\s*)?Context Usage/gi)];
  const contextStart = contextMatches.length ? contextMatches[contextMatches.length - 1].index ?? -1 : -1;
  if (contextStart < 0) {
    throw new Error(`AGY did not produce an Active Context report.\n\nCaptured output:\n${text.slice(0, 500) || "(empty)"}`);
  }
  const panel = text.slice(contextStart).split(/\n\s*(?:Related:|esc to cancel)/i)[0];
  const lines = panel.split("\n").map((line) => line.replace(/^[□◉⛁⊠\s]+/, "").trim()).filter(Boolean);

  return {
    modelLine: lines.find((line) => /tokens\s*$/i.test(line) || /tokens\s*\(/i.test(line)) ?? null,
    usageLine: lines.find((line) => /^estimated usage/i.test(line)) ?? null,
    categories: lines.filter((line) =>
      /^(?:User messages|Agent responses|Tool calls|System prompt|System tools|Skills|Subagents):/i.test(line)
    ),
    freeLine: lines.find((line) => /^free space:/i.test(line)) ?? null,
    checkpointLine: lines.find((line) => /^checkpoints?/i.test(line)) ?? null,
    checkpointDetail: lines.find((line) => /^└?\s*checkpoint \d+/i.test(line)) ?? null,
    artifactsCount: lines.filter((line) => line.startsWith("└ ") && /\.\w+:\s*[\d.]+k? tokens$/i.test(line)).length,
  };
}

/** Render a {@link ContextReport} into the Telegram HTML block. */
export function renderContext(report: ContextReport, zh = false): string {
  const title = zh ? "🧠 <b>活动上下文概览</b>" : "🧠 <b>Active Context</b>";
  const breakdownTitle = zh ? "<b>Token 细分统计</b>" : "<b>Token breakdown</b>";
  const artifactsLabel = zh ? "<b>产物文件 (Artifacts)：</b>" : "<b>Artifacts:</b>";

  const result = [
    title,
    report.modelLine,
    report.usageLine,
    report.categories.length ? `${breakdownTitle}\n${report.categories.map((line) => `• ${line}`).join("\n")}` : null,
    report.freeLine,
    report.checkpointLine && report.checkpointDetail ? `${report.checkpointLine} · ${report.checkpointDetail}` : report.checkpointLine,
    report.artifactsCount ? `${artifactsLabel} ${report.artifactsCount}` : null,
  ].filter((line): line is string => Boolean(line));
  return result.join("\n");
}

/** Back-compat one-shot: raw PTY output to rendered HTML. */
export function parseContext(rawOutput: string, cleaned?: string, zh = false): string {
  return renderContext(extractContext(rawOutput, cleaned), zh);
}

/**
 * Forgiving metrics extractor for telemetry. Never throws: returns whatever of
 * {tokens, currentTokens, maxTokens, percentage} can be recovered.
 */
export function parseContextMetrics(rawOutput: string): ContextMetrics {
  try {
    const text = cleanAnsi(rawOutput);
    const tokenMatch = text.match(/([\d.,]+[kKmM]?)\s*\/\s*([\d.,]+[kKmM]?)\s*tokens/i);
    const result: ContextMetrics = {};
    if (tokenMatch) {
      result.tokens = tokenMatch[1].trim();
      const current = parseTokenValue(tokenMatch[1]);
      const max = parseTokenValue(tokenMatch[2]);
      if (current !== null) result.currentTokens = current;
      if (max !== null) result.maxTokens = max;
      if (current !== null && max !== null && max > 0) {
        result.percentage = Math.min(100, Math.round((current / max) * 100));
      }
    }
    // Prefer explicit percentage strictly associated with the total context line
    // (e.g. "· 146.3k/1.0M tokens\n□ (14.0%)").
    const totalLinePct = text.match(/[\d.,]+[kKmM]?\s*\/\s*[\d.,]+[kKmM]?\s*tokens[^\n]*\(\s*([\d.]+)\s*%\s*\)/i)
      || text.match(/[\d.,]+[kKmM]?\s*\/\s*[\d.,]+[kKmM]?\s*tokens[^\n]*\n\s*[□◉⛁⊠\s]*\(\s*([\d.]+)\s*%\s*\)/i);
    if (totalLinePct) {
      result.percentage = Math.round(parseFloat(totalLinePct[1]));
    }
    return result;
  } catch {
    return {};
  }
}
