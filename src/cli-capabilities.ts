import { runAgyCommand } from "./agy-runner.js";
import { parseAgyModelsOutput, setActiveModels } from "./models.js";
import type { AgyConfig } from "./types.js";

export const DEFAULT_MODE_VALUES = ["plan", "accept-edits", "auto"] as const;
export const DEFAULT_EFFORT_VALUES = ["low", "medium", "high", "xhigh", "max"] as const;

export interface ParsedCliHelp {
  flags: string[];
  subcommands: string[];
  effort: string[];
  modes: string[];
}

export interface CliCapabilitiesSnapshot {
  version: string | null;
  efforts: string[];
  modes: string[];
  flags: string[];
  subcommands: string[];
  lastSyncedAt: string | null;
}

let activeEfforts: string[] = ["low", "medium", "high"];
let activeModes: string[] = ["plan", "accept-edits"];
let discoveredFlags: string[] = [];
let discoveredSubcommands: string[] = [];
let discoveredVersion: string | null = null;
let lastSyncedAt: string | null = null;

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

export function parseCliHelp(help: string): ParsedCliHelp {
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
  return {
    flags: sortedUnique(flags),
    subcommands: sortedUnique(subcommands),
    effort: sortedUnique(effort),
    modes: sortedUnique(modes),
  };
}

export function getActiveEfforts(): string[] {
  return activeEfforts;
}

export function setActiveEfforts(efforts: string[]): void {
  const cleaned = [...new Set(efforts.map((v) => v.trim().toLowerCase()).filter(Boolean))];
  if (cleaned.length > 0) activeEfforts = cleaned;
}

export function getActiveModes(): string[] {
  return activeModes;
}

export function setActiveModes(modes: string[]): void {
  const cleaned = [...new Set(modes.map((v) => v.trim().toLowerCase()).filter(Boolean))];
  if (cleaned.length > 0) activeModes = cleaned;
}

export function getDiscoveredFlags(): string[] {
  return discoveredFlags;
}

export function setDiscoveredFlags(flags: string[]): void {
  discoveredFlags = sortedUnique(flags.map((v) => v.trim()).filter(Boolean));
}

export function getDiscoveredSubcommands(): string[] {
  return discoveredSubcommands;
}

export function setDiscoveredSubcommands(subcommands: string[]): void {
  discoveredSubcommands = sortedUnique(subcommands.map((v) => v.trim()).filter(Boolean));
}

export function getCliVersion(): string | null {
  return discoveredVersion;
}

export function setCliVersion(version: string | null): void {
  discoveredVersion = version?.trim() || null;
}

export function getCliCapabilitiesSnapshot(): CliCapabilitiesSnapshot {
  return {
    version: discoveredVersion,
    efforts: [...activeEfforts],
    modes: [...activeModes],
    flags: [...discoveredFlags],
    subcommands: [...discoveredSubcommands],
    lastSyncedAt,
  };
}

const CAPABILITIES_TTL_MS = 5 * 60 * 1000;
let lastSyncedEpochMs = 0;

export function resetCliCapabilities(): void {
  activeEfforts = ["low", "medium", "high"];
  activeModes = ["plan", "accept-edits"];
  discoveredFlags = [];
  discoveredSubcommands = [];
  discoveredVersion = null;
  lastSyncedAt = null;
  lastSyncedEpochMs = 0;
}

export async function refreshCliCapabilities(
  agy: AgyConfig,
  options: { force?: boolean } = {},
): Promise<CliCapabilitiesSnapshot> {
  const now = Date.now();
  if (!options.force && lastSyncedEpochMs > 0 && now - lastSyncedEpochMs < CAPABILITIES_TTL_MS) {
    return getCliCapabilitiesSnapshot();
  }

  const [versionRes, helpRes, modelsRes] = await Promise.allSettled([
    runAgyCommand(agy, ["--version"], 10_000),
    runAgyCommand(agy, ["--help"], 15_000),
    runAgyCommand(agy, ["models"], 20_000),
  ]);

  if (versionRes.status === "fulfilled" && versionRes.value.trim()) {
    setCliVersion(versionRes.value.trim());
  }

  if (helpRes.status === "fulfilled" && helpRes.value.trim()) {
    const parsed = parseCliHelp(helpRes.value);
    if (parsed.effort.length > 0) {
      const order = ["low", "medium", "high", "xhigh", "max"];
      const ordered = parsed.effort.slice().sort((a, b) => {
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.localeCompare(b);
      });
      setActiveEfforts(ordered);
    }
    if (parsed.modes.length > 0) {
      const order = ["plan", "accept-edits", "auto"];
      const ordered = parsed.modes.slice().sort((a, b) => {
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.localeCompare(b);
      });
      setActiveModes(ordered);
    }
    if (parsed.flags.length > 0) setDiscoveredFlags(parsed.flags);
    if (parsed.subcommands.length > 0) setDiscoveredSubcommands(parsed.subcommands);
  }

  if (modelsRes.status === "fulfilled" && modelsRes.value.trim()) {
    const models = parseAgyModelsOutput(modelsRes.value);
    if (models.length > 0) {
      setActiveModels(models);
    }
  }

  lastSyncedEpochMs = now;
  lastSyncedAt = new Date(now).toISOString();
  return getCliCapabilitiesSnapshot();
}
