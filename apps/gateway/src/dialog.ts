/**
 * 多轮会话上下文与群背景感知管理器
 *
 * 核心机制：
 * 1. 15 分钟自然衰减超时（Auto Expire）：超过 15 分钟无互动自动归档清空，新提问从干净会话开启；
 * 2. 活跃问答轮次环（Multi-Turn Turns）：保留最近 6~8 轮真实 user <-> assistant 对话；
 * 3. 群聊背景感知环（Background Rolling Ring）：保留最近 20 条群内普通发言供话题参考；
 * 4. 微信群聊强约束引用格式封装。
 */

export interface DialogTurn {
  role: 'user' | 'assistant';
  content: string;
  sender?: string;
  timestamp: number;
  imgPath?: string;
}

export interface GroupBackgroundItem {
  sender: string;
  text: string;
  timestamp: number;
}

const SESSION_TTL_MS = 15 * 60 * 1000; // 15 分钟无互动自动衰减重置
const MAX_TURNS = 8;                   // 最多保留最近 8 条（4 轮）连贯问答
const MAX_BACKGROUND_ITEMS = 20;       // 最多保留最近 20 条群背景流水

class DialogManager {
  private sessions = new Map<string, { turns: DialogTurn[]; lastActiveAt: number }>();
  private groupBackgrounds = new Map<string, GroupBackgroundItem[]>();

  /** 记录群内普通发言流水（无需 @Nox，作为群背景感知） */
  recordGroupBackground(chatId: string, sender: string, text: string): void {
    if (!chatId.endsWith('@chatroom') || !text.trim()) return;
    let list = this.groupBackgrounds.get(chatId);
    if (!list) {
      list = [];
      this.groupBackgrounds.set(chatId, list);
    }
    list.push({
      sender: sender.slice(0, 30),
      text: text.slice(0, 150),
      timestamp: Date.now(),
    });
    if (list.length > MAX_BACKGROUND_ITEMS) {
      list.splice(0, list.length - MAX_BACKGROUND_ITEMS);
    }
  }

  /** 获取群最近背景摘要文本 */
  getGroupBackground(chatId: string, limit = 10): string {
    const list = this.groupBackgrounds.get(chatId);
    if (!list || list.length === 0) return '';
    const now = Date.now();
    // 只取最近 30 分钟以内的背景消息，防止过旧消息干扰
    const recent = list
      .filter((item) => now - item.timestamp < 30 * 60 * 1000)
      .slice(-limit);
    if (recent.length === 0) return '';
    return recent.map((item) => `${item.sender}: ${item.text}`).join('\n');
  }

  /** 获取当前对话的多轮历史（自动执行 15 分钟衰减判断） */
  getTurns(chatId: string): DialogTurn[] {
    const session = this.sessions.get(chatId);
    if (!session) return [];

    const now = Date.now();
    // 超过 15 分钟未活动，自动自然衰减清空，开始新话题
    if (now - session.lastActiveAt > SESSION_TTL_MS) {
      this.sessions.delete(chatId);
      return [];
    }
    return [...session.turns];
  }

  /** 追加一轮问答 */
  appendTurn(chatId: string, turn: DialogTurn): void {
    let session = this.sessions.get(chatId);
    const now = Date.now();
    if (!session || (now - session.lastActiveAt > SESSION_TTL_MS)) {
      session = { turns: [], lastActiveAt: now };
      this.sessions.set(chatId, session);
    }

    session.turns.push(turn);
    session.lastActiveAt = now;

    if (session.turns.length > MAX_TURNS) {
      session.turns.splice(0, session.turns.length - MAX_TURNS);
    }
  }

  /** 显式重置对话（如 /new 或 /clear） */
  resetSession(chatId: string): void {
    this.sessions.delete(chatId);
  }

  /** 获取会话剩余有效时间 (秒) */
  getRemainingTtlSec(chatId: string): number {
    const session = this.sessions.get(chatId);
    if (!session) return 0;
    const elapsed = Date.now() - session.lastActiveAt;
    if (elapsed > SESSION_TTL_MS) return 0;
    return Math.round((SESSION_TTL_MS - elapsed) / 1000);
  }
}

export const dialogManager = new DialogManager();

/** 格式化群聊强约束引用回复气泡 */
export function formatQuoteReply(options: {
  senderName: string;
  sourceText?: string;
  replyText: string;
  isGroup: boolean;
}): string {
  const { senderName, sourceText, replyText, isGroup } = options;
  if (!isGroup) return replyText;

  const name = (senderName || '群友').trim();
  let snippet = (sourceText || '').trim();
  // 剥离开头的 @Nox 标记
  snippet = snippet.replace(/^@[^\/\r\n\s  ]+[\s  ]*/, '').trim();
  if (snippet.length > 35) {
    snippet = snippet.slice(0, 35) + '...';
  }
  if (!snippet) {
    snippet = '图片/消息';
  }

  // 微信经典群引用格式：带引用气泡 + @提问者唤醒强提醒
  return `「${name}：${snippet}」\n- - - - - - - - - - - - - - -\n@${name} ${replyText}`;
}
