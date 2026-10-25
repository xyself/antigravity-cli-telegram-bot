import type { Usage } from "../types.js";
import { modelLabel } from "../models.js";
import { formatTokenCount } from "./usage-math.js";

export interface TelemetryData {
  title?: string;
  contextGrowthTokens?: number | null;
  activeTokens?: number | null;
  maxTokens: number;
  contextPercentage?: number | null;
  sessionUsageTotals?: Usage | null;
  sessionTurns?: number | null;
  sessionDurationMs?: number | null;
  inputTokens?: number;
  cacheReadTokens?: number;
  thinkingTokens?: number;
  outputTokens?: number;
  toolCalls: number;
  durationMs?: number | null;
  model: string;
  isZh?: boolean;
}

export type HealthStatus = "nominal" | "vigilance" | "alert";

export interface MetricDiagnostic {
  label: string;
  value: string;
  status: HealthStatus;
  comment: string;
  hasWarning?: boolean;
}

export function evaluateActiveContext(
  activeTokens: number | null | undefined,
  maxTokens: number,
  explicitPercentage?: number | null,
  isZh?: boolean
): { formatted: string; status: HealthStatus; comment: string; hasWarning: boolean; pct: number } {
  const safeMax = maxTokens > 0 ? maxTokens : 1_000_000;
  if (activeTokens != null && activeTokens > 0) {
    const calculatedPct = Math.min(100, Math.round((activeTokens / safeMax) * 100));
    const pct = typeof explicitPercentage === "number" && !Number.isNaN(explicitPercentage)
      ? Math.min(100, Math.max(0, Math.round(explicitPercentage)))
      : calculatedPct;
    let status: HealthStatus = "nominal";
    let comment = isZh ? "正常良好" : "Nominal";
    let hasWarning = false;

    if (pct > 70) {
      status = "alert";
      comment = isZh ? "预警（建议运行 /compact 压缩或 /new）" : "Alert (run /compact or /new)";
      hasWarning = true;
    } else if (pct >= 40) {
      status = "vigilance";
      comment = isZh ? "注意（建议考虑压缩或开启新会话）" : "Vigilance (consider compaction or archiving)";
    }

    return {
      formatted: `${activeTokens.toLocaleString("en-US")} / ${safeMax.toLocaleString("en-US")} ${isZh ? "Token" : "tokens"} (${pct}%)`,
      status,
      comment,
      hasWarning,
      pct,
    };
  }

  return {
    formatted: "N/A",
    status: "nominal",
    comment: isZh ? "未上报" : "Not reported",
    hasWarning: false,
    pct: 0,
  };
}

export function evaluatePromptCache(
  cacheReadTokens: number | undefined,
  inputTokens: number | undefined,
  isZh?: boolean
): { formatted: string; status: HealthStatus; comment: string; hitRate: number } {
  const cacheRead = cacheReadTokens ?? 0;
  const input = inputTokens ?? 0;
  const total = cacheRead + input;

  if (total > 0) {
    const hitRate = Math.round((cacheRead / total) * 100);
    let status: HealthStatus = "nominal";
    let comment = isZh ? "热缓存（最优命中）" : "Warm cache (optimal)";

    if (hitRate >= 80) {
      status = "nominal";
      comment = isZh ? "热缓存（最优命中）" : "Warm cache (optimal)";
    } else if (hitRate >= 30) {
      status = "vigilance";
      comment = isZh ? "命中率中等" : "Moderate hit rate";
    } else {
      status = "alert";
      comment = isZh ? "冷缓存 / 未命中" : "Cold cache / cache miss";
    }

    return {
      formatted: `${hitRate}% ${isZh ? "命中率" : "hit rate"}`,
      status,
      comment,
      hitRate,
    };
  }

  return {
    formatted: `0% ${isZh ? "命中率" : "hit rate"}`,
    status: "alert",
    comment: isZh ? "冷缓存 / 未命中" : "Cold cache / cache miss",
    hitRate: 0,
  };
}

export function evaluateThinkingTokens(
  thinkingTokens: number | undefined,
  isZh?: boolean
): { formatted: string; status: HealthStatus; comment: string } {
  if (thinkingTokens != null && thinkingTokens > 0) {
    let status: HealthStatus = "nominal";
    let comment = isZh ? "均衡思考" : "Balanced reasoning";

    if (thinkingTokens > 4000) {
      status = "alert";
      comment = isZh ? "深度长思考（检查提示词复杂度）" : "Extended reasoning (check prompt ambiguity)";
    } else if (thinkingTokens > 2500) {
      status = "vigilance";
      comment = isZh ? "深度思考" : "Deep reasoning";
    } else if (thinkingTokens >= 500) {
      status = "nominal";
      comment = isZh ? "均衡思考" : "Balanced reasoning";
    } else {
      status = "vigilance";
      comment = isZh ? "极简 / 快速思考" : "Fast / minimal reasoning";
    }

    return {
      formatted: `${thinkingTokens.toLocaleString("en-US")} ${isZh ? "Token" : "tokens"}`,
      status,
      comment,
    };
  }

  return {
    formatted: `0 ${isZh ? "Token" : "tokens"}`,
    status: "nominal",
    comment: isZh ? "极简 / 快速思考" : "Minimal / fast reasoning",
  };
}

export function evaluateToolCalls(
  toolCalls: number,
  isZh?: boolean
): { formatted: string; status: HealthStatus; comment: string; hasWarning: boolean; collapsedLabel: string } {
  if (toolCalls === 0) {
    return {
      formatted: isZh ? "0 次执行" : "0 executions",
      status: "nominal",
      comment: isZh ? "纯文本概念回答（未在服务器执行命令或文件操作）" : "Conceptual answer (no files or commands checked on server)",
      hasWarning: false,
      collapsedLabel: isZh ? "0 个工具" : "0 tools",
    };
  }

  if (toolCalls <= 4) {
    return {
      formatted: isZh ? `${toolCalls} 次执行` : `${toolCalls} execution${toolCalls > 1 ? "s" : ""}`,
      status: "nominal",
      comment: isZh ? "正常（已在服务器执行验证）" : "Nominal (verified on server)",
      hasWarning: false,
      collapsedLabel: isZh ? `${toolCalls} 个工具` : `${toolCalls} tool${toolCalls > 1 ? "s" : ""}`,
    };
  }

  if (toolCalls <= 10) {
    return {
      formatted: isZh ? `${toolCalls} 次执行` : `${toolCalls} executions`,
      status: "vigilance",
      comment: isZh ? "高工具活跃度" : "High tool activity",
      hasWarning: false,
      collapsedLabel: isZh ? `${toolCalls} 个工具` : `${toolCalls} tools`,
    };
  }

  return {
    formatted: isZh ? `${toolCalls} 次执行 ⚠️` : `${toolCalls} executions ⚠️`,
    status: "alert",
    comment: isZh ? "重度工具链（注意是否存在死循环）" : "Heavy tool chain (verify loop)",
    hasWarning: true,
    collapsedLabel: isZh ? `${toolCalls} 个工具 ⚠️` : `${toolCalls} tools ⚠️`,
  };
}

export function evaluateResponseSize(
  outputTokens: number | undefined,
  isZh?: boolean
): { formatted: string; status: HealthStatus; comment: string } {
  if (outputTokens != null && outputTokens > 0) {
    let status: HealthStatus = "nominal";
    let comment = isZh ? "输出精炼简短" : "Concise output";

    if (outputTokens > 1200) {
      status = "alert";
      comment = isZh ? "输出较长（可要求简要总结）" : "Verbose output (consider asking for summary)";
    } else if (outputTokens >= 600) {
      status = "vigilance";
      comment = isZh ? "输出详尽" : "Detailed output";
    }

    return {
      formatted: `${outputTokens.toLocaleString("en-US")} ${isZh ? "Token" : "tokens"}`,
      status,
      comment,
    };
  }

  return {
    formatted: "N/A",
    status: "nominal",
    comment: isZh ? "未上报输出大小" : "Output size not reported",
  };
}

export function formatSessionDuration(durationMs: number, isZh?: boolean): string {
  const totalSec = Math.round(durationMs / 1000);
  if (totalSec < 60) {
    const secStr = (durationMs / 1000).toFixed(1);
    return isZh ? `${secStr}秒 总计` : `${secStr}s total`;
  }
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes < 60) {
    return isZh ? `${minutes}分 ${seconds}秒 总计` : `${minutes}m ${seconds}s total`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return isZh ? `${hours}小时 ${remMinutes}分钟 总计` : `${hours}h ${remMinutes}m total`;
}

/**
 * Builds the native Telegram markdown expandable blockquote footer for telemetry.
 */
export function buildTelemetryQuoteBlock(data: TelemetryData): string {
  const isZh = data.isZh === true;
  const durationSec = data.durationMs != null ? `${(data.durationMs / 1000).toFixed(1)}s` : "0.0s";
  const contextEval = evaluateActiveContext(data.activeTokens, data.maxTokens, data.contextPercentage, isZh);
  const cacheEval = evaluatePromptCache(data.cacheReadTokens, data.inputTokens, isZh);
  const thinkingEval = evaluateThinkingTokens(data.thinkingTokens, isZh);
  const toolEval = evaluateToolCalls(data.toolCalls, isZh);
  const responseEval = evaluateResponseSize(data.outputTokens, isZh);

  // Net context delta added to active context this turn
  const growthTokens = data.contextGrowthTokens != null
    ? data.contextGrowthTokens
    : (data.activeTokens ?? 0);

  const growthLabel = growthTokens > 0
    ? `+${formatTokenCount(growthTokens)} ${isZh ? "上下文" : "ctx"}`
    : (growthTokens < 0 ? `-${formatTokenCount(Math.abs(growthTokens))} ${isZh ? "上下文" : "ctx"}` : `0 ${isZh ? "上下文" : "ctx"}`);

  const collapsedTools = toolEval.collapsedLabel;
  const collapsedCtx = `${contextEval.pct}% ${isZh ? "上下文" : "ctx"}${contextEval.hasWarning ? " ⚠️" : ""}`;

  const defaultTitle = isZh ? "运行统计" : "Run";
  const title = data.title || defaultTitle;
  const headerLine = `⚡ ${title}: ${growthLabel} · ${collapsedTools} · ${durationSec} · ${collapsedCtx}`;

  // Section 1: This turn
  const growthDetail = isZh
    ? (growthTokens >= 0
        ? `+${growthTokens.toLocaleString("en-US")} Token（计入活跃上下文）`
        : `${growthTokens.toLocaleString("en-US")} Token（已压缩/剪枝）`)
    : (growthTokens >= 0
        ? `+${growthTokens.toLocaleString("en-US")} tokens (feeds active context)`
        : `${growthTokens.toLocaleString("en-US")} tokens (pruned / compacted)`);

  const thisTurnLines = isZh
    ? [
        `⏱️ **本轮统计**`,
        `• **上下文增长：** ${growthDetail}`,
        `• **思考 Token：** ${thinkingEval.formatted} — ${thinkingEval.comment}`,
        `• **工具调用：** ${toolEval.formatted} — ${toolEval.comment}`,
        `• **模型与耗时：** ${modelLabel(data.model)} · ${durationSec}`,
      ]
    : [
        `⏱️ **This turn**`,
        `• **Context growth:** ${growthDetail}`,
        `• **Thinking tokens:** ${thinkingEval.formatted} — ${thinkingEval.comment}`,
        `• **Tool calls:** ${toolEval.formatted} — ${toolEval.comment}`,
        `• **Model & duration:** ${modelLabel(data.model)} · ${durationSec}`,
      ];

  // Section 2: Session totals
  const sessionLines = isZh
    ? [
        `📊 **会话累计**`,
        `• **活跃上下文：** ${contextEval.formatted} — ${contextEval.comment}`,
      ]
    : [
        `📊 **Session totals**`,
        `• **Active context:** ${contextEval.formatted} — ${contextEval.comment}`,
      ];

  if (data.sessionUsageTotals?.total_tokens || data.sessionTurns || data.sessionDurationMs) {
    const parts: string[] = [];
    if (data.sessionUsageTotals?.total_tokens) {
      parts.push(isZh ? `已消耗 ${formatTokenCount(data.sessionUsageTotals.total_tokens)} Token` : `${formatTokenCount(data.sessionUsageTotals.total_tokens)} tokens consumed`);
    }
    if (data.sessionTurns) {
      parts.push(isZh ? `${data.sessionTurns} 轮交互` : `${data.sessionTurns} ${data.sessionTurns === 1 ? "turn" : "turns"}`);
    }
    if (data.sessionDurationMs != null && data.sessionDurationMs > 0) {
      parts.push(formatSessionDuration(data.sessionDurationMs, isZh));
    }
    sessionLines.push(isZh ? `• **全局累计用量：** ${parts.join(" · ")}` : `• **Cumulative usage:** ${parts.join(" · ")}`);
  }

  sessionLines.push(isZh ? `• **提示词缓存：** ${cacheEval.formatted} — ${cacheEval.comment}` : `• **Prompt cache:** ${cacheEval.formatted} — ${cacheEval.comment}`);

  return [
    `**> ${headerLine}`,
    "**>",
    ...thisTurnLines.map((line) => `**> ${line}`),
    "**>",
    ...sessionLines.map((line) => `**> ${line}`),
  ].join("\n");
}
