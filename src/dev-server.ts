import http from "node:http";
import dns from "node:dns";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { BOT_COMMANDS, createAppServices, createBot } from "./bot.js";
import { loadConfig } from "./config.js";
import { ConversationDatabase } from "./db.js";
import { acquireInstanceLock, releaseInstanceLock } from "./infra/instance-lock.js";
import { defaultEnvFile, loadEnvFile } from "./setup.js";
import { StateStore } from "./state.js";
import { warmupWhisperLocal } from "./stt/stt-service.js";
import { escapeHtml, TelegramClient } from "./telegram.js";

dns.setDefaultResultOrder?.("ipv4first");

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { name: string; version: string; description?: string };

interface GatewayStatus {
  mode: "gateway+preview" | "preview-only";
  botRunning: boolean;
  configPresent: boolean;
  workspace: string;
  model: string;
  effort: string;
  agyMode: string;
  note: string;
}

async function loadRuntimeEnv(): Promise<void> {
  const candidates = process.env.AGY_ENV_FILE
    ? [process.env.AGY_ENV_FILE]
    : [path.resolve(process.cwd(), ".env"), defaultEnvFile()];
  const explicitEnv = Boolean(process.env.AGY_ENV_FILE);
  for (const envFile of candidates) {
    const savedEnv = await loadEnvFile(envFile);
    for (const [key, value] of Object.entries(savedEnv)) {
      if (explicitEnv || !process.env[key]?.trim()) {
        process.env[key] = value;
      }
    }
  }
}

function renderStatusHtml(status: GatewayStatus, port: number): string {
  const commandItems = BOT_COMMANDS.slice(0, 18)
    .map(
      (cmd) =>
        `<li><code>/${escapeHtml(cmd.command)}</code><span>${escapeHtml(cmd.description)}</span></li>`,
    )
    .join("");

  const badgeText = status.botRunning ? "Gateway + Preview Active" : "Preview Server Ready";
  const badgeColor = status.botRunning ? "#16a34a" : "#2563eb";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(packageJson.name)} — Gateway Status</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0b0f17;
      color: #e5e7eb;
      line-height: 1.5;
      padding: 32px 20px;
    }
    .container { max-width: 860px; margin: 0 auto; }
    .header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 24px;
      padding-bottom: 20px;
      border-bottom: 1px solid #1f2937;
    }
    h1 { margin: 0; font-size: 1.5rem; font-weight: 600; letter-spacing: -0.02em; }
    .subtitle { margin: 4px 0 0; color: #9ca3af; font-size: 0.92rem; }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-radius: 999px;
      font-size: 0.8rem;
      font-weight: 600;
      background: #111827;
      border: 1px solid ${badgeColor};
      color: #f9fafb;
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: ${badgeColor}; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-bottom: 24px;
    }
    .card {
      background: #111827;
      border: 1px solid #1f2937;
      border-radius: 10px;
      padding: 14px 16px;
    }
    .label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: #9ca3af; }
    .value { margin-top: 4px; font-size: 0.95rem; font-weight: 600; word-break: break-word; }
    .notice {
      background: #111827;
      border: 1px solid #1f2937;
      border-left: 3px solid ${badgeColor};
      border-radius: 8px;
      padding: 14px 16px;
      margin-bottom: 24px;
      color: #d1d5db;
      font-size: 0.92rem;
    }
    .commands {
      background: #111827;
      border: 1px solid #1f2937;
      border-radius: 10px;
      padding: 18px 20px;
    }
    .commands h2 { margin: 0 0 12px; font-size: 1rem; font-weight: 600; }
    ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
    li {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 6px 0;
      border-bottom: 1px solid #1f2937;
      font-size: 0.88rem;
    }
    li:last-child { border-bottom: none; }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      color: #93c5fd;
      white-space: nowrap;
    }
    li span { color: #9ca3af; text-align: right; }
  </style>
</head>
<body>
  <main class="container">
    <header class="header">
      <div>
        <h1>${escapeHtml(packageJson.name)} v${escapeHtml(packageJson.version)}</h1>
        <p class="subtitle">${escapeHtml(packageJson.description || "Antigravity CLI Telegram Bot Gateway")}</p>
      </div>
      <div class="badge"><span class="dot"></span>${escapeHtml(badgeText)}</div>
    </header>

    <section class="grid">
      <div class="card">
        <div class="label">HTTP Port</div>
        <div class="value">${port}</div>
      </div>
      <div class="card">
        <div class="label">Mode</div>
        <div class="value">${escapeHtml(status.agyMode)}</div>
      </div>
      <div class="card">
        <div class="label">Effort</div>
        <div class="value">${escapeHtml(status.effort)}</div>
      </div>
      <div class="card">
        <div class="label">Workspace</div>
        <div class="value">${escapeHtml(status.workspace)}</div>
      </div>
    </section>

    <section class="notice">${escapeHtml(status.note)}</section>

    <section class="commands">
      <h2>Registered Bot Commands (${BOT_COMMANDS.length} total)</h2>
      <ul>${commandItems}</ul>
    </section>
  </main>
</body>
</html>`;
}

async function main(): Promise<void> {
  await loadRuntimeEnv();

  const port = Number.parseInt(process.env.PORT || "3000", 10) || 3000;
  const hasTelegramConfig = Boolean(
    process.env.TELEGRAM_BOT_TOKEN?.trim() && process.env.TELEGRAM_ALLOWED_USER_IDS?.trim(),
  );

  const status: GatewayStatus = {
    mode: "preview-only",
    botRunning: false,
    configPresent: hasTelegramConfig,
    workspace: process.env.AGY_WORKSPACE?.trim() || "/srv/agy-workspaces/default",
    model: process.env.AGY_MODEL?.trim() || "default",
    effort: process.env.AGY_EFFORT?.trim() || "high",
    agyMode: process.env.AGY_MODE?.trim() || "plan",
    note: hasTelegramConfig
      ? "Telegram credentials detected. Starting bot polling loop..."
      : "Running in HTTP preview mode (TELEGRAM_BOT_TOKEN / TELEGRAM_ALLOWED_USER_IDS not configured). Set those environment variables or run `agy-telegram --setup` to enable Telegram polling.",
  };

  let instanceLockPath: string | undefined;

  if (hasTelegramConfig) {
    try {
      const config = loadConfig();
      status.workspace = config.agy.workspace;
      status.model = config.agy.model || "default";
      status.effort = config.agy.effort;
      status.agyMode = config.agy.mode;

      const lockPath = path.join(path.dirname(config.stateFile), "agy-telegram.lock");
      const lock = acquireInstanceLock(lockPath);
      if (!lock.acquired) {
        status.note = lock.holderPid
          ? `HTTP preview active. Another agy-telegram instance is already running (PID ${lock.holderPid}).`
          : `HTTP preview active. Could not acquire instance lock at ${lockPath}.`;
      } else {
        instanceLockPath = lockPath;
        const state = new StateStore(config.stateFile);
        await state.load();
        const services = createAppServices({
          config,
          state,
          convDb: new ConversationDatabase(config.agy.dbPath),
          telegram: new TelegramClient(config.telegram.token),
        });

        if (config.stt?.provider === "whisper-local") {
          void warmupWhisperLocal(config);
        }

        status.mode = "gateway+preview";
        status.botRunning = true;
        status.note = "Telegram bot polling is active alongside the HTTP status server.";

        void createBot(services)
          .start()
          .catch((error: unknown) => {
            status.botRunning = false;
            status.mode = "preview-only";
            status.note = `Telegram bot loop stopped: ${(error as Error).message}`;
            console.error("[dev-server] bot loop failed:", error);
          });
      }
    } catch (error) {
      status.note = `HTTP preview active. Bot configuration error: ${(error as Error).message}`;
      console.error("[dev-server] failed to initialize bot:", error);
    }
  }

  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (reqUrl.pathname === "/health" || reqUrl.pathname === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          ok: true,
          name: packageJson.name,
          version: packageJson.version,
          ...status,
        }),
      );
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderStatusHtml(status, port));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => resolve());
  });

  console.log(`[dev-server] ${packageJson.name} listening on http://0.0.0.0:${port} (${status.mode})`);

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      if (instanceLockPath) {
        releaseInstanceLock(instanceLockPath);
      }
      server.close(() => {
        process.exit(0);
      });
      setTimeout(() => process.exit(0), 2000).unref();
    });
  }
}

process.on("unhandledRejection", (reason) => {
  console.error("[dev-server] Unhandled Promise Rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[dev-server] Uncaught Exception:", error);
});

await main();
