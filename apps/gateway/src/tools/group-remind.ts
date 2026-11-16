import { addJob } from '../control.js';
import type { GatewayTool, ToolContext } from './types.js';

export function parseReminderTime(timeStr: string): { runAt: number; cronExpr: string | null } | null {
  const s = timeStr.trim();
  const now = Date.now();

  // 1. 相对时间：如 10m, 15min, 30s, 2h, 10分钟后, 1小时后
  const relSec = s.match(/^(\d+)\s*(s|sec|second|seconds|秒)(?:钟)?(?:后)?$/i);
  if (relSec) return { runAt: now + Number(relSec[1]) * 1000, cronExpr: null };

  const relMin = s.match(/^(\d+)\s*(m|min|minute|minutes|分|分钟)(?:后)?$/i);
  if (relMin) return { runAt: now + Number(relMin[1]) * 60_000, cronExpr: null };

  const relHour = s.match(/^(\d+)\s*(h|hour|hours|小时)(?:后)?$/i);
  if (relHour) return { runAt: now + Number(relHour[1]) * 3600_000, cronExpr: null };

  // 2. 当日具体时刻：如 15:30 或 09:05
  const timeOnly = s.match(/^(\d{1,2}):(\d{2})$/);
  if (timeOnly) {
    const target = new Date();
    target.setHours(Number(timeOnly[1]), Number(timeOnly[2]), 0, 0);
    let targetTs = target.getTime();
    if (targetTs <= now) {
      targetTs += 86400_000; // 如果时间已过，定为明天
    }
    return { runAt: targetTs, cronExpr: null };
  }

  // 3. 完整日期时间：如 2026-11-11 15:30
  const parsedTs = Date.parse(s.replace(/-/g, '/'));
  if (!isNaN(parsedTs) && parsedTs > now) {
    return { runAt: parsedTs, cronExpr: null };
  }

  return null;
}

export const groupRemindTool: GatewayTool = {
  name: 'group_remind',
  description: '在群聊或私聊中设定定时提醒或日程待办。到达指定时间后自动向会话发送提醒。',
  parameters: {
    type: 'object',
    properties: {
      time: {
        type: 'string',
        description: '提醒时间。支持相对时间（如 "10m"、"30s"、"2h"、"10分钟后"）或时间点（如 "15:30"、"2026-11-11 16:00"）',
      },
      content: {
        type: 'string',
        description: '提醒内容详情',
      },
      target: {
        type: 'string',
        description: '被提醒人名称或 @ 对象（可选）',
      },
    },
    required: ['time', 'content'],
  },
  execute: async (args: { time: string; content: string; target?: string }, ctx: ToolContext) => {
    const timeStr = String(args.time || '').trim();
    const content = String(args.content || '').trim();
    const target = args.target ? String(args.target).trim() : '';

    if (!content) return '提醒内容不能为空。';
    const parsed = parseReminderTime(timeStr);
    if (!parsed) {
      return `无法识别提醒时间“${timeStr}”。请提供如“10m”、“30分钟后”、“15:30”或“2026-11-11 16:00”等格式。`;
    }

    const jobId = `remind_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const promptPayload = `【定时提醒】${target ? `@${target} ` : ''}${content}`;
    const err = addJob(jobId, ctx.chatId, parsed.cronExpr, parsed.runAt, promptPayload, 'nox');
    if (err) return `设定提醒失败：${err}`;

    const dateStr = new Date(parsed.runAt).toLocaleTimeString('zh-CN', { hour12: false });
    return `已成功设定提醒！将于 ${dateStr} 发送提醒：“${content}”。(任务ID: ${jobId})`;
  },
};
