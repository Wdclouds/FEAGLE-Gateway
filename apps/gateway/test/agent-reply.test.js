// 覆盖 agent 空响应的处理约定：进程正常结束但没有文本、没有工具调用时，
// 不能当成「任务完成」——实测 gpt-6-sol 约 1/3 概率如此（只出推理 token）。
// 这里锁住三件事：重试只做一次、重试结果优先、空文本的答复必须如实（不说「任务完成」）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { isEmptyAgentResult, agentReplyText, promptWithEmptyRetry } from '../dist/agent-reply.js';

const ok = (text, tools = [], ms = 1000) => ({ ok: true, text, tools, durationMs: ms });
const fail = (error) => ({ ok: false, text: '', tools: [], error, durationMs: 500 });

test('空响应判定：只有「无文本且无工具调用」才算空', () => {
  assert.equal(isEmptyAgentResult(ok('')), true);
  assert.equal(isEmptyAgentResult(ok('有话说')), false);
  assert.equal(isEmptyAgentResult(ok('', [{ name: 'bash' }])), false, '调过工具不算空');
  assert.equal(isEmptyAgentResult(fail('boom')), false, '失败走失败分支');
});

test('有文本时原样返回', () => {
  assert.equal(agentReplyText(ok('0.8.4')), '0.8.4');
});

test('调过工具但没写总结：如实说明，不再谎称任务完成', () => {
  const text = agentReplyText(ok('', [{ name: 'bash' }]));
  assert.match(text, /没有给出文字总结/);
  assert.doesNotMatch(text, /任务完成/);
});

test('完全空响应：提示重试，不再谎称任务完成', () => {
  const text = agentReplyText(ok(''));
  assert.match(text, /没有返回内容/);
  assert.doesNotMatch(text, /任务完成/);
});

test('失败分支保留错误信息', () => {
  assert.match(agentReplyText(fail('Pi 进程意外退出')), /Pi 进程意外退出/);
});

test('空响应会重试一次，并采用重试结果', async () => {
  const calls = [];
  const retries = [];
  const result = await promptWithEmptyRetry(
    async () => {
      calls.push(Date.now());
      return calls.length === 1 ? ok('', [], 3200) : ok('真实答案');
    },
    (first) => retries.push(first),
  );
  assert.equal(calls.length, 2, '应当调用两次');
  assert.equal(retries.length, 1, '重试回调应当触发一次');
  assert.equal(result.text, '真实答案');
});

test('重试后仍为空：返回空结果，由 agentReplyText 如实告知', async () => {
  let n = 0;
  const result = await promptWithEmptyRetry(async () => {
    n += 1;
    return ok('', [], 3000);
  });
  assert.equal(n, 2, '只重试一次，不做无限重试');
  assert.equal(isEmptyAgentResult(result), true);
  assert.match(agentReplyText(result), /没有返回内容/);
});

test('正常结果不触发重试', async () => {
  let n = 0;
  const result = await promptWithEmptyRetry(async () => {
    n += 1;
    return ok('正常');
  });
  assert.equal(n, 1);
  assert.equal(result.text, '正常');
});

test('失败的 prompt 不重试（交给上层报错）', async () => {
  let n = 0;
  const result = await promptWithEmptyRetry(async () => {
    n += 1;
    return fail('总线断了');
  });
  assert.equal(n, 1);
  assert.equal(result.ok, false);
});
