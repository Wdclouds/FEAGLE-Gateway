import { config, isGroup } from '../config.js';
import { formatMemberProfileContext, type Persona } from '../control.js';
import { trace } from '../db.js';
import { dialogManager } from '../dialog.js';
import { distillMemories } from '../llm.js';
import { remember, semanticSearch, summon } from '../mnemosyne.js';
import { toCompactLines, type MemoryHit, type WxInboundPkt } from '../protocol.js';

export function buildTaskPrompt(pkts: WxInboundPkt[], memories: MemoryHit[], personaPrompt: string, imgDesc?: string | null): string {
  const last = pkts[pkts.length - 1];
  const history = toCompactLines(pkts.slice(0, -1));
  const turns = dialogManager.getTurns(last.c);
  const turnsText = turns.length > 0
    ? turns.map((t) => `${t.role === 'user' ? (t.sender || '用户') : '助手'}: ${t.content}`).join('\n')
    : '';
  const isGrp = isGroup(last.c);
  const groupBg = isGrp ? dialogManager.getGroupBackground(last.c) : '';
  const memberTag = isGrp ? formatMemberProfileContext(last.c, last.u, last.n) : '';
  const memBlock = memories.length
    ? memories.map((m, i) => `${i + 1}. [${m.created_at ? m.created_at.slice(0, 10) : '近期'}] ${m.content.slice(0, 300)}`).join('\n')
    : '（无命中）';
  return [
    '[人设指令]',
    personaPrompt,
    '',
    memberTag ? `[提问者成员画像]\n${memberTag}\n` : '',
    turnsText ? `[近期多轮问答上下文]\n${turnsText.slice(-1500)}\n` : '',
    groupBg ? `[群聊环境背景流水]\n${groupBg.slice(-800)}\n` : '',
    '[微信任务上下文]',
    history ? `近期窗口消息：\n${history.slice(-1000)}` : '',
    `[历史记忆参考（按时效加权排序）]\n${memBlock}`,
    '【记忆时效与时序仲裁约束】：',
    '1. 记忆内容按时间倒序及半衰期有效度排列；',
    '2. 新决策自动覆盖旧决策：当记忆中针对同一项目架构、配置或决策存在冲突时，必须严格以最新时间（或带有 [CURRENT] 标签）的记忆为准；',
    '3. 宁缺毋滥：若记忆内容依赖已下线或已废弃的旧方案，严禁生搬硬套，以当前对话与实际代码现状为准。',
    last.img
      ? `[用户发图] 图片内容转述：${imgDesc || '（视觉模型未能读取，可自行 cat 该文件查看）'}\n图片本地路径：${last.img}`
      : '',
    '',
    '[当前任务]',
    last.t,
    '',
    '要求：直接执行任务（可读写工作区文件、跑 shell、按需调用 mcp__mnemosyne__* 记忆工具），完成后输出简洁中文总结；代码与报错保持原样输出，不要改写。',
    '高危操作铁律：凡涉及删除数据/修改系统配置/重启服务/大范围文件变动的命令，执行前必须先调用 mcp__gateway-ctl__request_high_risk_exec 工具或等待权限审批获得用户批准，禁止直接执行。',
  ].filter(Boolean).join('\n');
}

export async function prefetchMemories(pkts: WxInboundPkt[], _persona: Persona): Promise<MemoryHit[]> {
  const chat = pkts[0]?.c ?? '-';
  const query = toCompactLines(pkts).slice(-400);
  let memories: MemoryHit[] = [];
  try {
    memories = await summon(query);
    if (memories.length === 0) {
      memories = await semanticSearch(query, {
        topK: 5,
        chatId: chat !== '-' ? chat : undefined,
        includeTest: false,
      });
    }
  } catch { /* 记忆库故障不阻塞任务 */ }
  trace(chat, 'L2', 'memory_prewarm', { hits: memories.length, chat });
  return memories;
}

export async function historian(chat: string, origin: WxInboundPkt, userTranscript: string, aiResult: string): Promise<void> {
  const t0 = Date.now();
  const transcript = `用户侧：\n${userTranscript}\n\nAI侧结果：\n${aiResult.slice(0, 3000)}`;
  const distilled = await distillMemories(transcript);
  if (!distilled.length) return;

  const isAdmin = config.adminWxids.includes(origin.u);
  const allowed = isAdmin
    ? distilled
    : distilled.filter((m) => ['project', 'knowledge', 'worklog', 'pitfall'].includes(m.category));

  let written = 0;
  for (const m of allowed) {
    const isGrp = isGroup(chat);
    const taggedContent = `[CURRENT][${m.category.toUpperCase()}] ${m.content}`;
    const ok = await remember(taggedContent, m.category, {
      source: 'historian',
      chat_id: chat,
      sender: origin.u,
      scope: isGrp ? 'group' : 'private',
      visibility: isGrp ? 'group' : 'private',
      is_test: false,
      ts: Date.now(),
    });
    if (ok) written++;
  }
  trace(chat, 'L3', 'historian', { distilled: distilled.length, written, admin: isAdmin }, Date.now() - t0);
}

export function isTestOrSystemChat(chatId: string): boolean {
  if (!chatId) return false;
  const lower = chatId.toLowerCase();
  return (
    lower.startsWith('test_') ||
    lower.startsWith('e2e_') ||
    lower.startsWith('qc_') ||
    lower.startsWith('notify:') ||
    lower.startsWith('gh_') ||
    lower === 'filehelper' ||
    lower === 'fmessage' ||
    lower === 'newsapp' ||
    lower === 'weixin'
  );
}
