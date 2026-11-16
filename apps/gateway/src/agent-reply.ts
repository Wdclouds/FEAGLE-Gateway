import type { PiResult } from './pi-manager.js';

/**
 * 空响应判定：agent 进程正常结束，但既没有文本也没有工具调用。
 * 实测 gpt-6-sol 约 1/3 概率只输出推理 token、正文为空（finish_reason=stop），
 * 这种情况不算任务完成，应当重试。
 */
export function isEmptyAgentResult(r: PiResult): boolean {
  return r.ok && !r.text && r.tools.length === 0;
}

/**
 * 把 agent 结果转成发给用户的话。
 * 空文本不再谎称「任务完成」：区分「有工具调用但没写总结」与「完全空响应」。
 */
export function agentReplyText(r: PiResult): string {
  if (!r.ok) return `任务失败：${r.error || '未知错误'}`;
  if (r.text) return r.text;
  return r.tools.length > 0
    ? '（任务执行完了，但模型没有给出文字总结）'
    : '（模型这次没有返回内容，重试后仍是空的，请再发一次或说明得更具体些）';
}

/**
 * 跑一次 prompt，遇到空响应重试一次。
 * @param run 执行一次 prompt
 * @param onRetry 真正发起重试前回调（用于记录 empty_retry 轨迹）
 * @returns 最终结果：正常结果，或重试后的结果（可能仍为空）
 */
export async function promptWithEmptyRetry(
  run: () => Promise<PiResult>,
  onRetry?: (first: PiResult) => void,
): Promise<PiResult> {
  const first = await run();
  if (!isEmptyAgentResult(first)) return first;
  onRetry?.(first);
  return run();
}
