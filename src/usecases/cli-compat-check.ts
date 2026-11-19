import fs from "node:fs/promises";
import path from "node:path";
import { runAgyCommand, TOP_LEVEL_COMMANDS } from "../agy-runner.js";
import {
  DEFAULT_EFFORT_VALUES,
  DEFAULT_MODE_VALUES,
  parseCliHelp,
  setActiveEfforts,
  setActiveModes,
  setCliVersion,
  setDiscoveredFlags,
  setDiscoveredSubcommands,
} from "../cli-capabilities.js";
import { t, type Lang } from "../i18n/index.js";
import { DEFAULT_MODELS, parseAgyModelsOutput, setActiveModels } from "../models.js";
import type { AgyConfig } from "../types.js";
import { formatChangelogSummary } from "../ui/screens.js";

export { parseCliHelp };

export interface CliSurface {
  version: string;
  flags: string[];
  subcommands: string[];
  effort: string[];
  modes: string[];
  models: string[];
  checkedAt?: string;
}

export interface DiffResult {
  added: string[];
  removed: string[];
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

export function parseModelsOutput(output: string): string[] {
  return sortedUnique(parseAgyModelsOutput(output).map((m) => m.id));
}

export function diffLists(before: string[], after: string[]): DiffResult {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((v) => !beforeSet.has(v)),
    removed: before.filter((v) => !afterSet.has(v)),
  };
}

export function buildReport(
  surface: CliSurface,
  baseline: CliSurface | null,
  changes: string[],
  gaps: string[],
  changelogLines: string[],
  syncedSummary: string,
  lang: Lang = "zh",
): string {
  const lines: string[] = [
    t(lang, "clicheck.title", { version: surface.version || t(lang, "clicheck.unknownVersion") }),
  ];

  if (!baseline) {
    lines.push("", t(lang, "clicheck.firstRun"));
  } else if (changes.length === 0) {
    lines.push("", t(lang, "clicheck.unchanged", { date: baseline.checkedAt?.slice(0, 10) || "—" }));
  } else {
    lines.push("", t(lang, "clicheck.changesHeader"), ...changes.map((c) => `  • ${c}`));
  }

  if (syncedSummary) {
    lines.push("", syncedSummary);
  }

  if (gaps.length > 0) {
    lines.push("", t(lang, "clicheck.gapsHeader"), ...gaps.map((g) => `  • ${g}`));
  }

  if (changelogLines.length > 0) {
    lines.push("", t(lang, "clicheck.latestChangelog"), ...changelogLines);
  }

  return lines.join("\n");
}

function formatDiffLine(label: string, diff: DiffResult, lang: Lang): string | null {
  const parts: string[] = [];
  if (diff.added.length) parts.push(`+${diff.added.join(", +")}`);
  if (diff.removed.length) parts.push(`-${diff.removed.join(", -")}`);
  return parts.length ? `${label}${lang === "zh" ? "：" : ": "}${parts.join("  ")}` : null;
}

export async function checkCliCompat(
  agy: AgyConfig,
  stateFile: string,
  lang: Lang = "zh",
): Promise<{ report: string; surface: CliSurface }> {
  const [versionRes, helpRes, modelsRes, changelogRes] = await Promise.allSettled([
    runAgyCommand(agy, ["--version"], 10_000),
    runAgyCommand(agy, ["--help"], 15_000),
    runAgyCommand(agy, ["models"], 20_000),
    runAgyCommand(agy, ["changelog"], 15_000),
  ]);

  const version = versionRes.status === "fulfilled" ? versionRes.value.trim() : "";
  const help = helpRes.status === "fulfilled" ? helpRes.value : "";
  const modelsRaw = modelsRes.status === "fulfilled" ? modelsRes.value : "";
  const changelogRaw = changelogRes.status === "fulfilled" ? changelogRes.value : "";

  const parsedHelp = parseCliHelp(help);
  const parsedModels = parseAgyModelsOutput(modelsRaw);
  const models = sortedUnique(parsedModels.map((m) => m.id));

  // Auto-sync runtime capabilities so the bot works immediately with new CLI versions
  if (version) setCliVersion(version);
  if (parsedHelp.effort.length > 0) setActiveEfforts(parsedHelp.effort);
  if (parsedHelp.modes.length > 0) setActiveModes(parsedHelp.modes);
  if (parsedHelp.flags.length > 0) setDiscoveredFlags(parsedHelp.flags);
  if (parsedHelp.subcommands.length > 0) setDiscoveredSubcommands(parsedHelp.subcommands);
  if (parsedModels.length > 0) setActiveModels(parsedModels);

  const surface: CliSurface = {
    version,
    ...parsedHelp,
    models,
    checkedAt: new Date().toISOString(),
  };

  const baselineFile = path.join(path.dirname(stateFile), "cli-baseline.json");
  let baseline: CliSurface | null = null;
  try {
    baseline = JSON.parse(await fs.readFile(baselineFile, "utf8")) as CliSurface;
  } catch {
    baseline = null;
  }

  const changes: string[] = [];
  if (baseline) {
    if (baseline.version !== surface.version) {
      changes.push(
        lang === "zh"
          ? `CLI 版本：${baseline.version || "?"} → ${surface.version || "?"}`
          : `CLI version: ${baseline.version || "?"} → ${surface.version || "?"}`,
      );
    }
    const pairs: Array<[string, DiffResult]> = [
      [lang === "zh" ? "子命令" : "Subcommands", diffLists(baseline.subcommands, surface.subcommands)],
      ["Flags", diffLists(baseline.flags, surface.flags)],
      ["--effort", diffLists(baseline.effort, surface.effort)],
      ["--mode", diffLists(baseline.modes, surface.modes)],
    ];
    if (surface.models.length > 0) {
      pairs.push([lang === "zh" ? "模型" : "Models", diffLists(baseline.models, surface.models)]);
    }
    for (const [label, diff] of pairs) {
      const line = formatDiffLine(label, diff, lang);
      if (line) changes.push(line);
    }
  }

  const gaps: string[] = [];
  const staticEfforts = new Set<string>(DEFAULT_EFFORT_VALUES);
  const newEffort = surface.effort.filter((v) => !staticEfforts.has(v));
  if (newEffort.length) {
    gaps.push(
      lang === "zh"
        ? `effort 新增 ${newEffort.join("、")}（已自动注入动态菜单）`
        : `New effort values ${newEffort.join(", ")} (auto-synced to menu)`,
    );
  }
  const staticModes = new Set<string>(DEFAULT_MODE_VALUES);
  const newModes = surface.modes.filter((v) => !staticModes.has(v));
  if (newModes.length) {
    gaps.push(
      lang === "zh"
        ? `mode 新增 ${newModes.join("、")}（已自动注入动态菜单）`
        : `New mode values ${newModes.join(", ")} (auto-synced to menu)`,
    );
  }
  const newSubs = surface.subcommands.filter((v) => !TOP_LEVEL_COMMANDS.has(v));
  if (newSubs.length) {
    gaps.push(
      lang === "zh"
        ? `子命令 ${newSubs.join("、")}（已自动放行 /agy 调用）`
        : `New subcommands ${newSubs.join(", ")} (auto-enabled in /agy)`,
    );
  }
  const knownModels = new Set(DEFAULT_MODELS.map((m) => m.id));
  const newModels = surface.models.filter((id) => !knownModels.has(id));
  if (newModels.length) {
    gaps.push(
      lang === "zh"
        ? `DEFAULT_MODELS 静态表未收录：${newModels.join(", ")}（已自动同步至当前运行实例）`
        : `Not in static DEFAULT_MODELS: ${newModels.join(", ")} (auto-synced to runtime)`,
    );
  }

  const changelogLines = changelogRaw
    ? formatChangelogSummary(changelogRaw)
        .split("\n")
        .filter((line) => !line.startsWith("仅显示最新版本"))
        .map((line) => `  ${line}`)
    : [];

  try {
    await fs.mkdir(path.dirname(baselineFile), { recursive: true });
    await fs.writeFile(baselineFile, JSON.stringify(surface, null, 2), "utf8");
  } catch {
    // Non-fatal: still return the report even if baseline persistence fails.
  }

  const syncedSummary = t(lang, "clicheck.synced", {
    models: surface.models.length || DEFAULT_MODELS.length,
    efforts: surface.effort.length || DEFAULT_EFFORT_VALUES.length,
    modes: surface.modes.length || DEFAULT_MODE_VALUES.length,
    subcommands: surface.subcommands.length || TOP_LEVEL_COMMANDS.size,
  });

  return {
    report: buildReport(surface, baseline, changes, gaps, changelogLines, syncedSummary, lang),
    surface,
  };
}
