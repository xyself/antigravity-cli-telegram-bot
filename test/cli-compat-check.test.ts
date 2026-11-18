import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReport,
  diffLists,
  parseCliHelp,
  parseModelsOutput,
} from "../src/usecases/cli-compat-check.js";

const HELP = `Usage of agy:
  --effort                        Reasoning effort for the current CLI session (low|medium|high|xhigh|max)
  --mode                          Set the agent execution mode for this session (accept-edits, auto, plan)
  --model                         Model for the current CLI session
  -p                              Short alias for --print
  --print                         Run a single prompt non-interactively and print the response

Available subcommands:
  changelog       Show changelog and release notes
  models          List available models
  update          Update CLI
`;

const MODELS = `Fetching available models...
gemini-3.8-flash-high\tGemini 3.8 Flash (High)
gemini-3.8-flash-low\tGemini 3.8 Flash (Low)
claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)
`;

test("parseCliHelp extracts flags, subcommands, effort and mode values", () => {
  const parsed = parseCliHelp(HELP);
  assert.deepEqual(parsed.flags, ["--effort", "--mode", "--model", "--print"]);
  assert.deepEqual(parsed.subcommands, ["changelog", "models", "update"]);
  assert.deepEqual(parsed.effort, ["high", "low", "max", "medium", "xhigh"]);
  assert.deepEqual(parsed.modes, ["accept-edits", "auto", "plan"]);
});

test("parseModelsOutput extracts tab-separated ids and skips the fetching line", () => {
  assert.deepEqual(parseModelsOutput(MODELS), [
    "claude-sonnet-4-6",
    "gemini-3.8-flash-high",
    "gemini-3.8-flash-low",
  ]);
  assert.deepEqual(parseModelsOutput(""), []);
});

test("diffLists reports added and removed entries", () => {
  assert.deepEqual(diffLists(["a", "b"], ["b", "c"]), { added: ["c"], removed: ["a"] });
  assert.deepEqual(diffLists(["a"], ["a"]), { added: [], removed: [] });
});

test("buildReport marks the first run and lists gaps", () => {
  const surface = {
    version: "1.5.11",
    flags: ["--print"],
    subcommands: ["models"],
    effort: ["high", "low", "max", "medium", "xhigh"],
    modes: ["accept-edits", "auto", "plan"],
    models: ["gemini-3.8-flash-low"],
  };
  const report = buildReport(surface, null, [], ["effort 新增 max、xhigh，bot 只认 low、medium、high"], [], "");
  assert.match(report, /首次检查/);
  assert.match(report, /effort 新增 max、xhigh/);
});

test("buildReport lists drift against a baseline", () => {
  const surface = {
    version: "1.5.12",
    flags: ["--print"],
    subcommands: ["models"],
    effort: ["high", "low", "medium"],
    modes: ["accept-edits", "plan"],
    models: [],
  };
  const baseline = {
    version: "1.5.11",
    flags: ["--print"],
    subcommands: ["models"],
    effort: ["high", "low", "medium"],
    modes: ["accept-edits", "plan"],
    models: [],
    checkedAt: "2026-11-19T00:00:00.000Z",
  };
  const report = buildReport(surface, baseline, ["CLI 版本：1.5.11 → 1.5.12"], [], [], "");
  assert.match(report, /1\.5\.11 → 1\.5\.12/);
  assert.match(report, /自上次检查的变化/);
});
