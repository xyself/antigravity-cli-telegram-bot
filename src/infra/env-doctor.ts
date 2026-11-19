import fs from "node:fs";
import path from "node:path";
import type { Lang } from "../i18n/index.js";
import { escapeHtml } from "../telegram.js";
import type { AppConfig } from "../types.js";

export interface BinaryCheck {
  name: string;
  target: string;
  available: boolean;
  resolvedPath?: string;
}

export interface EnvDoctorReport {
  nodeVersion: string;
  agy: BinaryCheck;
  git: BinaryCheck;
  workspace: { path: string; exists: boolean };
  projectsRoot: { path: string; exists: boolean };
  dbPath: { path: string; exists: boolean };
  mode: string;
  effort: string;
  sandbox: boolean;
}

export function checkBinaryAvailable(bin: string): { available: boolean; resolvedPath?: string } {
  const trimmed = (bin || "").trim();
  if (!trimmed) return { available: false };

  if (trimmed.includes(path.sep) || path.isAbsolute(trimmed)) {
    try {
      fs.accessSync(trimmed, fs.constants.X_OK);
      return { available: true, resolvedPath: trimmed };
    } catch {
      return { available: false };
    }
  }

  const pathEnv = process.env.PATH || "";
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, trimmed);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return { available: true, resolvedPath: candidate };
    } catch {
      // keep scanning PATH
    }
  }
  return { available: false };
}

export function inspectEnvironment(config: AppConfig): EnvDoctorReport {
  const agyCheck = checkBinaryAvailable(config.agy.bin);
  const gitCheck = checkBinaryAvailable("git");

  return {
    nodeVersion: process.version,
    agy: {
      name: "AGY CLI",
      target: config.agy.bin,
      available: agyCheck.available,
      resolvedPath: agyCheck.resolvedPath,
    },
    git: {
      name: "Git",
      target: "git",
      available: gitCheck.available,
      resolvedPath: gitCheck.resolvedPath,
    },
    workspace: {
      path: config.agy.workspace,
      exists: fs.existsSync(config.agy.workspace),
    },
    projectsRoot: {
      path: config.agy.projectsRoot,
      exists: fs.existsSync(config.agy.projectsRoot),
    },
    dbPath: {
      path: config.agy.dbPath,
      exists: fs.existsSync(config.agy.dbPath),
    },
    mode: config.agy.mode,
    effort: config.agy.effort,
    sandbox: config.agy.sandbox,
  };
}

export function formatEnvDoctorHtml(report: EnvDoctorReport, lang: Lang): string {
  const zh = lang === "zh";
  const ok = (yes: boolean) => (yes ? "🟢" : "🔴");
  const warn = (yes: boolean) => (yes ? "🟢" : "🟡");

  const lines: string[] = [
    zh ? "<b>🩺 环境健康诊断 (Doctor)</b>" : "<b>🩺 Environment Health Doctor</b>",
    "",
    `${ok(report.agy.available)} <b>AGY CLI:</b> <code>${escapeHtml(report.agy.resolvedPath || report.agy.target)}</code>${report.agy.available ? "" : zh ? " (未找到可执行文件)" : " (not found)"}`,
    `${ok(report.git.available)} <b>Git:</b> <code>${escapeHtml(report.git.resolvedPath || report.git.target)}</code>${report.git.available ? "" : zh ? " (未安装，Diff/Commit/Clone 将不可用)" : " (missing — Diff/Commit/Clone unavailable)"}`,
    `${warn(report.workspace.exists)} <b>${zh ? "默认工作区" : "Default Workspace"}:</b> <code>${escapeHtml(report.workspace.path)}</code>${report.workspace.exists ? "" : zh ? " (目录不存在)" : " (missing)"}`,
    `${warn(report.projectsRoot.exists)} <b>${zh ? "项目根目录" : "Projects Root"}:</b> <code>${escapeHtml(report.projectsRoot.path)}</code>${report.projectsRoot.exists ? "" : zh ? " (目录不存在)" : " (missing)"}`,
    `${warn(report.dbPath.exists)} <b>${zh ? "会话历史库" : "Conversation DB"}:</b> ${report.dbPath.exists ? (zh ? "已就绪" : "Ready") : (zh ? "尚未生成（首次对话后自动创建）" : "Not created yet")}`,
    "",
    `⚙️ <b>${zh ? "运行环境" : "Runtime"}:</b> Node <code>${escapeHtml(report.nodeVersion)}</code> · Mode <code>${escapeHtml(report.mode)}</code> · Effort <code>${escapeHtml(report.effort)}</code> · Sandbox <code>${report.sandbox ? "ON" : "OFF"}</code>`,
  ];

  if (!report.agy.available) {
    lines.push(
      "",
      zh
        ? "💡 <i>提示：请确认服务器已安装 <code>agy</code> CLI，并在 <code>.env</code> 中配置正确的 <code>AGY_BIN</code> 路径。</i>"
        : "💡 <i>Tip: Install the <code>agy</code> CLI and set <code>AGY_BIN</code> in your <code>.env</code> if it lives outside PATH.</i>",
    );
  }

  return lines.join("\n");
}
