import { runAgyCommand } from "../agy-runner.js";
import type { AppContext } from "../context.js";
import { createMainKeyboard } from "../keyboards.js";
import { backKeyboard } from "../ui/inline-keyboards.js";
import { isZh, settingsFor } from "../domain/settings.js";
import { escapeHtml } from "../telegram.js";
import { reply, replyWithHtml } from "../ui/reply.js";
import type { ChatId } from "../types.js";

export interface SkillItem {
  name: string;
  description: string;
  path: string;
  builtin?: boolean;
  model_invocable?: boolean;
}

export type SkillScope = "project" | "global" | "builtin";

export interface CategorizedSkill extends SkillItem {
  scope: SkillScope;
}

export function categorizeSkill(skill: SkillItem, workspacePath?: string): SkillScope {
  if (skill.builtin) return "builtin";
  if (skill.path) {
    if (skill.path.includes("/.agents/skills/") || skill.path.includes("/_agents/skills/")) {
      return "project";
    }
    if (workspacePath && skill.path.startsWith(workspacePath)) {
      return "project";
    }
    if (skill.path.includes("/.gemini/config/skills/")) {
      return "global";
    }
  }
  return "global";
}

export function parseSkillsJson(rawOutput: string, workspacePath?: string): CategorizedSkill[] | null {
  try {
    const data = JSON.parse(rawOutput);
    const skillsList: SkillItem[] = data?.command?.data?.skills || data?.skills;
    if (!Array.isArray(skillsList)) return null;
    return skillsList.map((skill) => ({
      ...skill,
      scope: categorizeSkill(skill, workspacePath),
    }));
  } catch {
    return null;
  }
}

export function formatSkillsHtml(skills: CategorizedSkill[], filterName?: string, zh = false): string {
  if (filterName) {
    const cleanFilter = filterName.trim().toLowerCase();
    const matched = skills.find((s) => s.name.toLowerCase() === cleanFilter);
    if (!matched) {
      return zh
        ? `⚡ <b>AGY 技能</b>\n\n未找到技能「<b>${escapeHtml(filterName)}</b>」。输入 <code>/skills</code> 可查看所有可用技能。`
        : `⚡ <b>AGY Skills</b>\n\nSkill "<b>${escapeHtml(filterName)}</b>" not found. Use <code>/skills</code> to view all available skills.`;
    }
    const scopeLabel = zh
      ? (matched.scope === "project" ? "📁 项目技能" : matched.scope === "global" ? "🌐 全局技能" : "📦 内置技能")
      : (matched.scope === "project" ? "📁 Project" : matched.scope === "global" ? "🌐 Global" : "📦 Built-in");
    const desc = matched.description || (zh ? "暂无描述" : "No description provided.");
    const pathLabel = zh ? "路径:" : "Path:";
    return [
      `⚡ <b>${zh ? "技能" : "Skill"}: ${escapeHtml(matched.name)}</b> (${scopeLabel})`,
      `${escapeHtml(desc)}`,
      `<b>${pathLabel}</b> <code>${escapeHtml(matched.path)}</code>`,
    ].join("\n\n");
  }

  if (!skills.length) {
    return zh ? "⚡ <b>AGY 技能列表</b>\n\n当前无可用技能。" : "⚡ <b>AGY Skills</b>\n\nNo skills available.";
  }

  const projectSkills = skills.filter((s) => s.scope === "project").sort((a, b) => a.name.localeCompare(b.name));
  const globalSkills = skills.filter((s) => s.scope === "global").sort((a, b) => a.name.localeCompare(b.name));
  const builtinSkills = skills.filter((s) => s.scope === "builtin").sort((a, b) => a.name.localeCompare(b.name));

  const sections: string[] = [];
  sections.push(zh ? `⚡ <b>AGY 技能列表（共 ${skills.length} 个可用）</b>` : `⚡ <b>AGY Skills (${skills.length} available)</b>`);

  const emptyDesc = zh ? "暂无描述" : "No description";
  const formatList = (items: CategorizedSkill[]) =>
    items.map((item) => `• <b>${escapeHtml(item.name)}</b>: ${escapeHtml(item.description || emptyDesc)}`).join("\n");

  if (projectSkills.length > 0) {
    sections.push(zh ? `📁 <b>项目技能 (${projectSkills.length})</b>\n${formatList(projectSkills)}` : `📁 <b>Project Skills (${projectSkills.length})</b>\n${formatList(projectSkills)}`);
  }
  if (globalSkills.length > 0) {
    sections.push(zh ? `🌐 <b>全局技能 (${globalSkills.length})</b>\n${formatList(globalSkills)}` : `🌐 <b>Global Skills (${globalSkills.length})</b>\n${formatList(globalSkills)}`);
  }
  if (builtinSkills.length > 0) {
    sections.push(zh ? `📦 <b>内置技能 (${builtinSkills.length})</b>\n${formatList(builtinSkills)}` : `📦 <b>Built-in Skills (${builtinSkills.length})</b>\n${formatList(builtinSkills)}`);
  }

  return sections.join("\n\n");
}

export async function handleSkillsCommand(context: AppContext, chatId: ChatId, filterName?: string, messageId?: number): Promise<void> {
  const settings = settingsFor(context, chatId);
  const zh = isZh(settings, context, chatId);
  const workspacePath = settings.workspace || context.config.agy.workspace;
  const effectiveAgyConfig = workspacePath === context.config.agy.workspace
    ? context.config.agy
    : { ...context.config.agy, workspace: workspacePath };

  try {
    const output = await runAgyCommand(
      effectiveAgyConfig,
      ["--print", "/skills", "--output-format", "json", "--dangerously-skip-permissions"],
      context.config.agy.timeoutMs
    );

    const parsedSkills = parseSkillsJson(output, workspacePath);
    if (parsedSkills) {
      const html = formatSkillsHtml(parsedSkills, filterName, zh);
      if (messageId) {
        try {
          await context.telegram.editMessageText(chatId, messageId, html, backKeyboard(zh), "HTML");
        } catch {
          await context.telegram.editMessageText(chatId, messageId, html.replace(/<[^>]+>/g, ""), backKeyboard(zh)).catch(() => undefined);
        }
      } else {
        await replyWithHtml(context, chatId, html, createMainKeyboard(settingsFor(context, chatId)));
      }
    } else {
      const title = zh ? "⚡ AGY 技能列表" : "AGY skills";
      const emptyMsg = zh ? "当前无可用技能。" : "No skills found.";
      const text = `${title}\n\n${output || emptyMsg}`;
      if (messageId) {
        await context.telegram.editMessageText(chatId, messageId, text, backKeyboard(zh)).catch(() => undefined);
      } else {
        await reply(context, chatId, text, createMainKeyboard(settingsFor(context, chatId)));
      }
    }
  } catch (error) {
    const errorPrefix = zh ? "无法读取 AGY 技能列表: " : "Could not read AGY skills: ";
    const errorText = `${errorPrefix}${(error as Error).message}`;
    if (messageId) {
      await context.telegram.editMessageText(chatId, messageId, errorText, backKeyboard(zh)).catch(() => undefined);
    } else {
      await reply(context, chatId, errorText, createMainKeyboard(settingsFor(context, chatId)));
    }
  }
}
