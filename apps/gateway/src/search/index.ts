import { config } from '../config.js';
import { SearchOrchestrator } from './orchestrator.js';
import { FactVerifier } from './verifier.js';

export * from './types.js';
export * from './orchestrator.js';
export * from './verifier.js';
export * from './providers/bing.js';
export * from './providers/tavily.js';
export * from './providers/huggingface.js';

// 单例搜索编排器
export const globalSearchOrchestrator = new SearchOrchestrator({
  tavilyApiKeys: config.search?.tavilyApiKeys,
  priority: config.search?.priority,
});

// 单例事实核验器，采用动态 import 避免与 llm.ts 发生 ESM 循环引用
export const globalFactVerifier = new FactVerifier(
  globalSearchOrchestrator,
  async (messages, opts) => {
    try {
      const { antigravityChatResponse } = await import('../llm.js');
      const res = await antigravityChatResponse(messages, opts);
      return res?.content ?? null;
    } catch {
      return null;
    }
  }
);
