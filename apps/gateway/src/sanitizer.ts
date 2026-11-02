import { config } from './config.js';
import type { WxOutboundBatch, WxOutboundItem } from './protocol.js';

const SECRET_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /nvapi-[A-Za-z0-9_-]{20,}/g, label: '[NIM_KEY已脱敏]' },
  { re: /sk-[A-Za-z0-9]{20,}/g, label: '[SK_KEY已脱敏]' },
  { re: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, label: '[JWT已脱敏]' },
  { re: /ghp_[A-Za-z0-9]{30,}/g, label: '[GHP已脱敏]' },
  { re: /AIza[A-Za-z0-9_-]{30,}/g, label: '[GKEY已脱敏]' },
];

// ============ 注入攻击与提示词投毒防御 (硬规则检测，0 延迟 0 成本) ============
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior)\s+instructions/i,
  /system\s*prompt/i,
  /you\s+are\s+now\s+(in\s+developer\s+mode|dan|jailbreak)/i,
  /forget\s+(everything|all\s+your\s+rules)/i,
  /输出.*(系统|初始化|内置)?(提示词|指令|prompt)/i,
  /忽略.*(设定|规则|提示|约束)/i,
  /从现在开始.*(dan|无限制|开发者模式|越狱)/i,
  /角色扮演.*无视道德/i,
  /eval\s*\(|exec\s*\(|<script\b/i,
];

/** 检测是否为恶意投毒或提示词越狱注入攻击 */
export function isPromptInjectionOrToxic(text: string): { blocked: boolean; reason?: string } {
  const t = text.trim();
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(t)) {
      return { blocked: true, reason: '检测到提示词越狱/越权投毒特征，已被底层安全防火墙硬拦截。' };
    }
  }
  return { blocked: false };
}

/** 脱敏：密钥/令牌替换为占位（严禁原样回传微信） */
export function desensitize(text: string): string {
  let out = text;
  for (const p of SECRET_PATTERNS) out = out.replace(p.re, p.label);
  return out;
}

/** 微信不支持的复杂格式清洗（保真优先，只动微信真渲染不了的） */
export function cleanForWeChat(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b-\u200f\u2028\u2029]/g, '')
    .replace(/```(\w*)\n?/g, '```\n')       // 归一化代码围栏
    .replace(/\n{4,}/g, '\n\n\n')            // 压缩超长空行
    .trim();
}

/** 切分微批次：代码块/段落边界优先，超长强切 */
export function splitChunks(text: string, chunkSize = config.out.chunkSize): string[] {
  const chunks: string[] = [];
  let buf = '';
  const flush = () => {
    const t = buf.trim();
    if (t) chunks.push(t);
    buf = '';
  };
  // 按代码围栏整块拆，围栏内不再切
  const parts = text.split(/(```[\s\S]*?```)/g);
  for (const part of parts) {
    if (part.startsWith('```')) {
      if (part.length > chunkSize * 3) {
        // 超大代码块：硬切
        flush();
        for (let i = 0; i < part.length; i += chunkSize * 3) {
          chunks.push(part.slice(i, i + chunkSize * 3).trim());
        }
      } else {
        if (buf) flush();
        chunks.push(part.trim());
      }
    } else {
      for (const para of part.split(/\n{2,}/)) {
        const p = para.trim();
        if (!p) continue;
        if ((buf + '\n\n' + p).length > chunkSize) {
          flush();
          if (p.length > chunkSize) {
            for (let i = 0; i < p.length; i += chunkSize) chunks.push(p.slice(i, i + chunkSize));
          } else buf = p;
        } else {
          buf = buf ? buf + '\n\n' + p : p;
        }
      }
    }
  }
  flush();
  return chunks.length ? chunks : ['(空回复)'];
}

function randDelay(): number {
  return config.out.minDelay + Math.floor(Math.random() * (config.out.maxDelay - config.out.minDelay));
}

/** 第 3 层同步轨道：纯 TS 规则直出（严禁小模型二次改写代码与报错，防失真） */
export function buildOutboundBatch(
  chatId: string,
  rawText: string,
  atU?: string
): WxOutboundBatch {
  const clean = cleanForWeChat(desensitize(rawText));
  const seq: WxOutboundItem[] = splitChunks(clean).map((t, i) => ({
    t,
    d: i === 0 ? 300 : randDelay(), // 首条快发，后续拟人间隔
  }));
  const batch: WxOutboundBatch = { c: chatId, seq };
  if (atU) batch.at_u = atU;
  return batch;
}

/** 单条快捷回复（第 0/1 层直答用） */
export function quickBatch(chatId: string, text: string, atU?: string): WxOutboundBatch {
  const batch = buildOutboundBatch(chatId, text, atU);
  return batch;
}
