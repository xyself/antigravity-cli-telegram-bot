/**
 * `/credits` report: pure extraction and rendering.
 */
import { cleanAnsi } from "./report-text.js";

export interface CreditsReport {
  /** Remaining credits/balance text, verbatim, e.g. "$12.34" or "150 G1 credits". */
  creditsRemaining: string | null;
  /** Purchase / top-up URL, if present. */
  purchaseUrl: string | null;
  /**
   * When neither credits nor a URL could be isolated, the cleaned, de-noised
   * lines of the panel so the caller can still show something useful.
   */
  fallbackLines: string[] | null;
}

/** Extract a {@link CreditsReport}. Throws when no credits info is present. */
export function extractCredits(rawOutput: string, cleaned?: string): CreditsReport {
  const text = (cleaned ?? cleanAnsi(rawOutput)).trim();

  const hasCreditsIndicator = /credits?|balance|purchase|buy/i.test(text);
  if (!hasCreditsIndicator) {
    throw new Error(
      `AGY did not produce a Credits report.\n\nCaptured output:\n${text.slice(0, 500) || "(empty)"}`
    );
  }

  const creditsMatch =
    text.match(/(?:(?:G1\s+)?credits\s*remaining|(?:available\s+)?credits|balance)[:\s]*([0-9$][^\n\r]*)/i) ||
    text.match(/([0-9]+(?:\.[0-9]+)?\s*(?:credits|G1 credits))/i);

  const purchaseMatch =
    text.match(/(?:Purchase(?:\s+link)?|Buy)[:\s]*(https?:\/\/[^\s)]+)/i) ||
    text.match(/(https?:\/\/[^\s)]+)/i);

  const creditsRemaining = creditsMatch ? creditsMatch[1].trim() : null;
  const purchaseUrl = purchaseMatch ? purchaseMatch[1].trim() : null;

  let fallbackLines: string[] | null = null;
  if (!creditsRemaining && !purchaseUrl) {
    fallbackLines = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.includes("/credits") && !l.startsWith("❯") && !l.startsWith(">"));
  }

  return { creditsRemaining, purchaseUrl, fallbackLines };
}

/** Render a {@link CreditsReport} into the Telegram HTML block. */
export function renderCredits(report: CreditsReport, zh = false): string {
  const header = zh ? "💳 <b>AGY 积分与额度</b>\n" : "💳 <b>AGY Credits</b>\n";
  const lines = [header];
  if (report.creditsRemaining) {
    lines.push(zh ? `• 剩余积分：<b>${report.creditsRemaining}</b>` : `• Credits Remaining: <b>${report.creditsRemaining}</b>`);
  }
  if (report.purchaseUrl) {
    lines.push(zh ? `• 充值 / 购买链接：<a href="${report.purchaseUrl}">${report.purchaseUrl}</a>` : `• Purchase / Top-up: <a href="${report.purchaseUrl}">${report.purchaseUrl}</a>`);
  }
  if (!report.creditsRemaining && !report.purchaseUrl && report.fallbackLines) {
    lines.push(report.fallbackLines.join("\n"));
  }
  return lines.join("\n").trim();
}

/** Back-compat one-shot: raw PTY output to rendered HTML. */
export function parseCredits(rawOutput: string, cleaned?: string, zh = false): string {
  return renderCredits(extractCredits(rawOutput, cleaned), zh);
}
