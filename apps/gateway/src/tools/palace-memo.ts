import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { remember, semanticSearch } from '../mnemosyne.js';
import type { ChannelMemo, GatewayTool, ToolContext } from './types.js';

function getChannelMemosPath(chatId: string): string {
  return join(config.channelsDir, chatId, 'memos.json');
}

export function saveChannelMemoFallback(chatId: string, memo: ChannelMemo): void {
  try {
    const chatDir = join(config.channelsDir, chatId);
    if (!existsSync(chatDir)) mkdirSync(chatDir, { recursive: true });
    const p = getChannelMemosPath(chatId);
    let list: ChannelMemo[] = [];
    if (existsSync(p)) {
      list = JSON.parse(readFileSync(p, 'utf-8'));
    }
    list.unshift(memo);
    if (list.length > 50) list = list.slice(0, 50);
    writeFileSync(p, JSON.stringify(list, null, 2), 'utf-8');
  } catch { /* 容错 */ }
}

export function searchChannelMemoFallback(chatId: string, keyword: string): ChannelMemo[] {
  try {
    const p = getChannelMemosPath(chatId);
    if (!existsSync(p)) return [];
    const list: ChannelMemo[] = JSON.parse(readFileSync(p, 'utf-8'));
    const kw = keyword.toLowerCase();
    return list.filter((m) => m.content.toLowerCase().includes(kw)).slice(0, 5);
  } catch {
    return [];
  }
}

export const palaceMemoTool: GatewayTool = {
  name: 'palace_memo',
  description: '向记忆宫殿归档重要信息/备忘录，或检索以往归档的记忆知识。',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['save', 'search'],
        description: '操作类型：save（归档存入）或 search（检索历史记忆）',
      },
      content: {
        type: 'string',
        description: '归档的事实内容，或者检索记忆的关键词',
      },
      category: {
        type: 'string',
        enum: ['worklog', 'knowledge', 'preference', 'project', 'pitfall'],
        description: '记忆分类（默认 knowledge）',
      },
    },
    required: ['action', 'content'],
  },
  execute: async (
    args: { action: 'save' | 'search'; content: string; category?: string },
    ctx: ToolContext
  ) => {
    const action = String(args.action || 'save').toLowerCase();
    const content = String(args.content || '').trim();
    const category = String(args.category || 'knowledge');

    if (!content) return '操作内容不能为空。';

    if (action === 'save') {
      await remember(content, category, {
        chatId: ctx.chatId,
        sender: ctx.senderName,
        ts: Date.now(),
      });
      saveChannelMemoFallback(ctx.chatId, {
        content,
        category,
        sender: ctx.senderName,
        ts: Date.now(),
      });
      return `已成功将备忘存入记忆宫殿（分类: ${category}）：\n“${content}”`;
    }

    if (action === 'search') {
      const hits = await semanticSearch(content, { topK: 3, chatId: ctx.chatId });
      if (!hits.length) {
        const localHits = searchChannelMemoFallback(ctx.chatId, content);
        if (!localHits.length) {
          return `在记忆宫殿中未找到与“${content}”相关的记录。`;
        }
        return [
          `检索到 ${localHits.length} 条本地群备忘：`,
          ...localHits.map(
            (h, i) => `${i + 1}. [${new Date(h.ts).toISOString().slice(0, 10)}] ${h.content}`
          ),
        ].join('\n');
      }
      return [
        `记忆宫殿检索结果：`,
        ...hits.map(
          (h, i) =>
            `${i + 1}. [${h.created_at ? h.created_at.slice(0, 10) : '近期'}] ${h.content}`
        ),
      ].join('\n');
    }

    return `未知操作类型“${action}”，仅支持 save 或 search。`;
  },
};
