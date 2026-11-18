import { promises as fs } from "node:fs";
import path from "node:path";
import { runAgyCommand } from "../agy-runner.js";
import { EFFORT_VALUES, MODE_VALUES } from "../config.js";
import { DEFAULT_MODELS } from "../models.js";
import type { AgyConfig } from "../types.js";
import { formatChangelogSummary } from "../ui/screens.js";

// 升级哨兵：把当前装的 AGY CLI 与 bot 的认知逐项对一遍。
// 每次跑完 `agy update` 来一次 /cli-check，就能看到这次更新到底影响 bot 的哪几处。
// 基线存在 state.json 同目录的 cli-baseline.json 里；每次检查成功都会刷新基线。

export interface CliBaseline {
  version: string;
  flags: string[];
  subcommands: string[];
  effort: string[];
  modes: string[];
  models: string[];
  checkedAt: string;
}

export interface CliSurface {
  version: string;
  flags: string[];
  subcommands: string[];
  effort: string[];
  modes: string[];
  models: string[];
}

export interface CliCheckResult {
  surface: CliSurface;
  isFirstRun: boolean;
  changes: string[];
  gaps: string[];
  warnings: string[];
  changelog: string;
  report: string;
}

const BOT_EFFORT_VALUES: string[] = [...EFFORT_VALUES];
const BOT_MODE_VALUES: string[] = [...MODE_VALUES];
const BOT_MODEL_IDS = DEFAULT_MODELS.map((model) => model.id);

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

export function parseCliHelp(help: string): Omit<CliSurface, "version" | "models"> {
  const flags: string[] = [];
  const subcommands: string[] = [];
  let effort: string[] = [];
  let modes: string[] = [];
  let inSubcommands = false;
  for (const line of help.split(/\r?\n/)) {
    if (line.trim() === "Available subcommands:") {
      inSubcommands = true;
      continue;
    }
    if (inSubcommands) {
      const sub = /^ {2}([a-z][a-z0-9-]*)\s+\S/.exec(line);
      if (sub) subcommands.push(sub[1]);
      continue;
    }
    const flag = /^ {2}--([a-z][a-z0-9-]*)\b/.exec(line);
    if (flag) flags.push(`--${flag[1]}`);
    if (line.includes("--effort")) {
      const m = /\(([^)]+)\)/.exec(line);
      if (m) effort = m[1].split(/[|,]/).map((v) => v.trim()).filter(Boolean);
    }
    if (line.includes("--mode")) {
      const m = /\(([^)]+)\)/.exec(line);
      if (m) modes = m[1].split(/[|,]/).map((v) => v.trim()).filter(Boolean);
    }
  }
  return { flags: sortedUnique(flags), subcommands: sortedUnique(subcommands), effort: sortedUnique(effort), modes: sortedUnique(modes) };
}

export function parseModelsOutput(output: string): string[] {
  const ids: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const tab = line.indexOf("\t");
    if (tab <= 0) continue;
    const id = line.slice(0, tab).trim();
    if (id) ids.push(id);
  }
  return sortedUnique(ids);
}

export function diffLists(oldList: string[], newList: string[]): { added: string[]; removed: string[] } {
  const oldSet = new Set(oldList);
  const newSet = new Set(newList);
  return {
    added: [...newSet].filter((v) => !oldSet.has(v)).sort(),
    removed: [...oldSet].filter((v) => !newSet.has(v)).sort(),
  };
}

function baselinePath(stateFile: string): string {
  return path.join(path.dirname(stateFile), "cli-baseline.json");
}

async function readBaseline(stateFile: string): Promise<CliBaseline | null> {
  try {
    return JSON.parse(await fs.readFile(baselinePath(stateFile), "utf8")) as CliBaseline;
  } catch {
    return null;
  }
}

async function writeBaseline(stateFile: string, surface: CliSurface): Promise<void> {
  const file = baselinePath(stateFile);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const baseline: CliBaseline = { ...surface, checkedAt: new Date().toISOString() };
  await fs.writeFile(file, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
}

function formatBaselineDate(iso: string): string {
  const d = new Date(iso);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

export function buildReport(
  surface: CliSurface,
  baseline: CliBaseline | null,
  changes: string[],
  gaps: string[],
  warnings: string[],
  changelog: string,
): string {
  const lines: string[] = [`🔍 CLI 兼容检查 · ${surface.version || "未知版本"}`];
  if (!baseline) {
    lines.push("📌 首次检查，已记录基线。下次 CLI 更新后来跑 /cli-check，就能看到变了什么。");
  } else if (changes.length === 0) {
    lines.push(`✅ 与上次基线一致（${formatBaselineDate(baseline.checkedAt)}）。`);
  } else {
    lines.push("📋 自上次检查的变化：");
    for (const change of changes) lines.push(`• ${change}`);
  }
  if (gaps.length) {
    lines.push("⚠️ CLI 有、bot 还不认：");
    for (const gap of gaps) lines.push(`• ${gap}`);
  }
  for (const warning of warnings) lines.push(`⚠️ ${warning}`);
  if (changelog) lines.push(`\n📰 最新版：\n${changelog}`);
  return lines.join("\n");
}

export async function checkCliCompat(agy: AgyConfig, stateFile: string): Promise<CliCheckResult> {
  const warnings: string[] = [];
  const version = (await runAgyCommand(agy, ["--version"])).trim();
  let help = "";
  let modelsOut = "";
  let changelogOut = "";
  try {
    help = await runAgyCommand(agy, ["--help"]);
  } catch (error) {
    warnings.push(`读取 agy --help 失败：${(error as Error).message}`);
  }
  try {
    modelsOut = await runAgyCommand(agy, ["models"], 120_000);
  } catch (error) {
    warnings.push(`读取 agy models 失败：${(error as Error).message}`);
  }
  try {
    changelogOut = await runAgyCommand(agy, ["changelog"]);
  } catch (error) {
    warnings.push(`读取 agy changelog 失败：${(error as Error).message}`);
  }
  const parsed = parseCliHelp(help);
  const surface: CliSurface = { version, ...parsed, models: parseModelsOutput(modelsOut) };

  // CLI 有、bot 不认：只报“新增”的方向；反方向（bot 有、CLI 没给，如账号没开通的模型）是预期内的，不报。
  const gaps: string[] = [];
  const effortGap = surface.effort.filter((v) => !BOT_EFFORT_VALUES.includes(v));
  if (effortGap.length) gaps.push(`effort 新增 ${effortGap.join("、")}，bot 只认 ${BOT_EFFORT_VALUES.join("、")}（config.ts EFFORT_VALUES）`);
  const modeGap = surface.modes.filter((v) => !BOT_MODE_VALUES.includes(v));
  if (modeGap.length) gaps.push(`mode 新增 ${modeGap.join("、")}，bot 只认 ${BOT_MODE_VALUES.join("、")}（config.ts MODE_VALUES）`);
  const modelGap = surface.models.filter((id) => !BOT_MODEL_IDS.includes(id));
  if (modelGap.length) gaps.push(`模型新增 ${modelGap.join("、")}，bot 模型表 models.ts 没有`);

  const baseline = await readBaseline(stateFile);
  const changes: string[] = [];
  if (baseline) {
    if (baseline.version !== surface.version) changes.push(`CLI 版本：${baseline.version} → ${surface.version}`);
    // 某一路读取失败时那一路是空的，跳过它的 diff，避免误报“全部移除”。
    const sections: Array<[string, string[], string[], boolean]> = [
      ["flag", baseline.flags, surface.flags, help.trim().length > 0],
      ["子命令", baseline.subcommands, surface.subcommands, help.trim().length > 0],
      ["effort", baseline.effort, surface.effort, help.trim().length > 0],
      ["mode", baseline.modes, surface.modes, help.trim().length > 0],
      ["模型", baseline.models, surface.models, modelsOut.trim().length > 0],
    ];
    for (const [label, oldList, newList, usable] of sections) {
      if (!usable) continue;
      const { added, removed } = diffLists(oldList, newList);
      if (added.length) changes.push(`${label}新增：${added.join("、")}`);
      if (removed.length) changes.push(`${label}移除：${removed.join("、")}`);
    }
  }
  await writeBaseline(stateFile, surface);
  const changelog = changelogOut ? formatChangelogSummary(changelogOut) : "";
  const report = buildReport(surface, baseline, changes, gaps, warnings, changelog);
  return { surface, isFirstRun: baseline === null, changes, gaps, warnings, changelog, report };
}
