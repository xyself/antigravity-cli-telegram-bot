import type { ModelOption } from "./types.js";

export const DEFAULT_MODELS: ModelOption[] = [
  // Gemini 4 — added in agy 1.5.8
  { id: "gemini-4-hydrogen-xhigh",  label: "Gemini 4 Hydrogen (XHigh)",  maxContextWindow: 1_000_000 },
  { id: "gemini-4-hydrogen-high",   label: "Gemini 4 Hydrogen (High)",   maxContextWindow: 1_000_000 },
  { id: "gemini-4-hydrogen-medium", label: "Gemini 4 Hydrogen (Medium)", maxContextWindow: 1_000_000 },
  { id: "gemini-4-hydrogen-low",    label: "Gemini 4 Hydrogen (Low)",    maxContextWindow: 1_000_000 },
  { id: "gemini-4-carbon-high",     label: "Gemini 4 Carbon (High)",     maxContextWindow: 2_000_000 },
  { id: "gemini-4-carbon-medium",   label: "Gemini 4 Carbon (Medium)",   maxContextWindow: 2_000_000 },
  { id: "gemini-4-carbon-low",      label: "Gemini 4 Carbon (Low)",      maxContextWindow: 2_000_000 },
  // Gemini 3.8
  { id: "gemini-3.8-flash-high",   label: "Gemini 3.8 Flash (High)",   maxContextWindow: 1_000_000 },
  { id: "gemini-3.8-flash-medium", label: "Gemini 3.8 Flash (Medium)", maxContextWindow: 1_000_000 },
  { id: "gemini-3.8-flash-low",    label: "Gemini 3.8 Flash (Low)",    maxContextWindow: 1_000_000 },
  // Non-Gemini
  { id: "claude-sonnet-4-6",         label: "Claude Sonnet 4.6 (Thinking)", maxContextWindow: 200_000 },
  { id: "claude-opus-4-6-thinking",  label: "Claude Opus 4.6 (Thinking)",   maxContextWindow: 200_000 },
  { id: "gpt-oss-120b-medium",       label: "GPT-OSS 120B (Medium)",        maxContextWindow: 128_000 },
];

let activeModels: ModelOption[] = [...DEFAULT_MODELS];

export function getActiveModels(): ModelOption[] {
  return activeModels;
}

export function setActiveModels(models: ModelOption[]): void {
  if (models && models.length > 0) {
    activeModels = models;
  }
}

export function parseAgyModelsOutput(output: string): ModelOption[] {
  const models: ModelOption[] = [];
  const lines = output.split(/\r?\n/);
  for (const rawLine of lines) {
    const cleaned = rawLine.replace(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏\s]+/g, "").trim();
    if (!cleaned) continue;
    const stripped = cleaned.replace(/.*fetching available models\.*\s*/i, "").trim();
    if (!stripped) continue;
    const match = stripped.match(/^([a-z0-9_.-]+)\s+(.+)$/i);
    if (match) {
      const id = match[1].trim();
      const label = match[2].trim();
      if (id && label && !id.includes(" ")) {
        const lower = id.toLowerCase();
        let maxContextWindow = 1_000_000;
        if (lower.includes("pro") || lower.includes("carbon")) maxContextWindow = 2_000_000;
        else if (lower.includes("claude")) maxContextWindow = 200_000;
        else if (lower.includes("gpt")) maxContextWindow = 128_000;
        models.push({ id, label, maxContextWindow });
      }
    }
  }
  return models;
}

export interface ModelFamily {
  baseId: string;
  baseLabel: string;
  efforts: string[];
  variants: ModelOption[];
  maxContextWindow: number;
}

const EFFORT_SUFFIX_RE = /-(low|medium|high|xhigh|max|ultra)$/i;

export function modelBaseId(modelId: string | null | undefined): string {
  if (!modelId) return "";
  return modelId.replace(EFFORT_SUFFIX_RE, "");
}

export function modelBaseLabel(label: string): string {
  return label.replace(/\s*\((low|medium|high|xhigh|max|ultra)\)\s*$/i, "").trim();
}

export function getModelFamilies(models: ModelOption[] = getActiveModels()): ModelFamily[] {
  const familyMap = new Map<string, ModelFamily>();
  for (const model of models) {
    const suffixMatch = model.id.match(EFFORT_SUFFIX_RE);
    const baseId = suffixMatch ? model.id.slice(0, -suffixMatch[0].length) : model.id;
    const effort = suffixMatch ? suffixMatch[1].toLowerCase() : null;
    const baseLabel = suffixMatch ? modelBaseLabel(model.label) : model.label;

    let fam = familyMap.get(baseId);
    if (!fam) {
      fam = {
        baseId,
        baseLabel,
        efforts: [],
        variants: [],
        maxContextWindow: model.maxContextWindow || 1_000_000,
      };
      familyMap.set(baseId, fam);
    }
    fam.variants.push(model);
    if (effort && !fam.efforts.includes(effort)) {
      fam.efforts.push(effort);
    }
  }
  return Array.from(familyMap.values());
}

/**
 * Given a model ID or base family ID (e.g. "gemini-4-hydrogen" or "gemini-4-hydrogen-high")
 * and a desired effort level (e.g. "xhigh"), returns the matching variant ID if the family
 * has effort-suffixed variants, or the exact model ID otherwise.
 */
export function resolveModelWithEffort(
  modelOrBaseId: string | null | undefined,
  desiredEffort: string | null | undefined,
  models: ModelOption[] = getActiveModels(),
): { modelId: string | null; effort: string | null } {
  if (!modelOrBaseId) return { modelId: null, effort: desiredEffort || null };
  const exact = models.find((m) => m.id === modelOrBaseId);
  const suffixMatch = modelOrBaseId.match(EFFORT_SUFFIX_RE);

  // If the user explicitly passed a full suffixed ID like "gemini-4-hydrogen-low" via CLI/callback
  // and didn't request a new effort override, honor that exact variant and sync effort
  const baseId = suffixMatch ? modelOrBaseId.slice(0, -suffixMatch[0].length) : modelOrBaseId;
  const families = getModelFamilies(models);
  const family = families.find((f) => f.baseId === baseId);

  if (!family) {
    return {
      modelId: modelOrBaseId,
      effort: suffixMatch ? suffixMatch[1].toLowerCase() : (desiredEffort || null),
    };
  }

  if (family.efforts.length === 0) {
    // Model without effort variants (e.g. claude-sonnet-4-6)
    return { modelId: family.variants[0].id, effort: desiredEffort || null };
  }

  // If modelOrBaseId was a base family ID (or we are changing effort on an active family),
  // pick the variant matching desiredEffort, falling back to high -> medium -> first variant
  const targetEffort = (
    suffixMatch && !desiredEffort
      ? suffixMatch[1].toLowerCase()
      : desiredEffort?.toLowerCase()
  ) || "high";

  const candidateId = `${family.baseId}-${targetEffort}`;
  const matchedVariant = family.variants.find((v) => v.id.toLowerCase() === candidateId.toLowerCase());
  if (matchedVariant) {
    const matchedSuffix = matchedVariant.id.match(EFFORT_SUFFIX_RE)?.[1]?.toLowerCase() || targetEffort;
    return { modelId: matchedVariant.id, effort: matchedSuffix };
  }

  // If exact variant was passed and exists, keep it
  if (exact) {
    const exactSuffix = exact.id.match(EFFORT_SUFFIX_RE)?.[1]?.toLowerCase() || targetEffort;
    return { modelId: exact.id, effort: exactSuffix };
  }

  // Fallback to high or first available variant in the family
  const highVariant = family.variants.find((v) => v.id.endsWith("-high")) || family.variants[0];
  const fallbackSuffix = highVariant.id.match(EFFORT_SUFFIX_RE)?.[1]?.toLowerCase() || targetEffort;
  return { modelId: highVariant.id, effort: fallbackSuffix };
}

export function modelLabel(id: string | null): string {
  if (!id) return "AGY default";
  const exact = getActiveModels().find((model) => model.id === id);
  if (exact) return exact.label;
  const family = getModelFamilies().find((f) => f.baseId === id);
  if (family) return family.baseLabel;
  return id;
}

export function getModelMaxContext(id: string | null): number {
  if (!id) return 1_000_000;
  const match = getActiveModels().find((model) => model.id === id);
  if (match?.maxContextWindow) return match.maxContextWindow;
  const family = getModelFamilies().find((f) => f.baseId === modelBaseId(id));
  if (family?.maxContextWindow) return family.maxContextWindow;
  const lower = id.toLowerCase();
  if (lower.includes("carbon") || lower.includes("pro")) return 2_000_000;
  if (lower.includes("gemini")) return 1_000_000;
  if (lower.includes("claude")) return 200_000;
  if (lower.includes("gpt")) return 128_000;
  return 1_000_000;
}

export function renderContextProgressBar(activeTokens: number, maxTokens: number, barLength = 10): string {
  if (maxTokens <= 0) return `${activeTokens.toLocaleString()} tokens`;
  if (activeTokens > maxTokens) {
    return `${activeTokens.toLocaleString()} tokens (Session Total)`;
  }
  const percentage = Math.min(100, Math.max(0, (activeTokens / maxTokens) * 100));
  const filledLength = Math.min(barLength, Math.round((percentage / 100) * barLength));
  const emptyLength = Math.max(0, barLength - filledLength);
  const bar = "█".repeat(filledLength) + "░".repeat(emptyLength);
  const maxLabel = maxTokens >= 1_000_000 ? `${(maxTokens / 1_000_000).toFixed(0)}M` : `${(maxTokens / 1_000).toFixed(0)}K`;
  return `[${bar}] ${percentage.toFixed(1)}% (${activeTokens.toLocaleString()} / ${maxLabel})`;
}
