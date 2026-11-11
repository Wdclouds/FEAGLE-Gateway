import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseReminderTime,
  groupRemindTool,
  palaceMemoTool,
  executeToolCall,
  getToolsForChat,
  searchBing,
  toOpenAiTools,
  webSearchTool,
} from '../dist/tools.js';
import { config } from '../dist/config.js';
import { listJobs, deleteJob, initControlPlane } from '../dist/control.js';

// 初始化数据库与控制平面
initControlPlane();

test('parseReminderTime correctly parses relative and absolute times', () => {
  const now = Date.now();
  // 1. 10m
  const t10m = parseReminderTime('10m');
  assert.ok(t10m);
  assert.ok(Math.abs(t10m.runAt - (now + 600_000)) < 2000);

  // 2. 30s
  const t30s = parseReminderTime('30s');
  assert.ok(t30s);
  assert.ok(Math.abs(t30s.runAt - (now + 30_000)) < 2000);

  // 3. 2小时后
  const t2h = parseReminderTime('2小时后');
  assert.ok(t2h);
  assert.ok(Math.abs(t2h.runAt - (now + 7200_000)) < 2000);

  // 4. 无效时间返回 null
  assert.equal(parseReminderTime('hello world'), null);
});

test('groupRemindTool schedules job into database', async () => {
  const ctx = {
    chatId: 'test_remind_chat@chatroom',
    senderWxid: 'wxid_bob',
    senderName: '鲍勃',
    isGroup: true,
    isAdmin: false,
  };

  const res = await groupRemindTool.execute(
    { time: '10m', content: '项目进度例会', target: '全体成员' },
    ctx
  );
  assert.match(res, /已成功设定提醒/);
  assert.match(res, /项目进度例会/);

  // 验证任务已进入 jobs 队列
  const jobs = listJobs();
  const created = jobs.find((j) => j.chat_id === ctx.chatId && j.prompt_payload.includes('项目进度例会'));
  assert.ok(created);
  assert.match(created.prompt_payload, /@全体成员 项目进度例会/);

  // 清理测试任务
  deleteJob(created.id);
});

test('palaceMemoTool saves and retrieves memos with channel sandbox fallback', async () => {
  const testChatId = 'test_memo_chat@chatroom';
  const chatDir = join(config.channelsDir, testChatId);
  if (existsSync(chatDir)) rmSync(chatDir, { recursive: true, force: true });

  const ctx = {
    chatId: testChatId,
    senderWxid: 'wxid_alice',
    senderName: '爱丽丝',
    isGroup: true,
    isAdmin: false,
  };

  // 1. 保存备忘
  const saveRes = await palaceMemoTool.execute(
    {
      action: 'save',
      content: '前端构建必须使用 Node 22 环境',
      category: 'knowledge',
    },
    ctx
  );
  assert.match(saveRes, /已成功将备忘存入记忆宫殿/);

  // 验证 channels/<chatId>/memos.json 已持久化
  const memosFile = join(chatDir, 'memos.json');
  assert.ok(existsSync(memosFile));
  const fileContent = JSON.parse(readFileSync(memosFile, 'utf-8'));
  assert.equal(fileContent.length, 1);
  assert.equal(fileContent[0].content, '前端构建必须使用 Node 22 环境');

  // 2. 检索备忘
  const searchRes = await palaceMemoTool.execute(
    {
      action: 'search',
      content: 'Node 22',
    },
    ctx
  );
  assert.match(searchRes, /前端构建必须使用 Node 22 环境/);

  rmSync(chatDir, { recursive: true, force: true });
});

test('executeToolCall enforces sandbox tool guard and schema validation', async () => {
  const ctx = {
    chatId: 'test_guard_chat@chatroom',
    senderWxid: 'wxid_test',
    senderName: '测试员',
    isGroup: true,
    isAdmin: false,
  };

  // 1. 允许工具白名单拦截非白名单工具
  const blockedRes = await executeToolCall(
    'dangerous_shell',
    '{}',
    ctx,
    ['web_search', 'group_remind']
  );
  assert.match(blockedRes, /\[安全拦截\]/);

  // 2. 允许工具名单包含该工具时放行
  const allowedRes = await executeToolCall(
    'group_remind',
    JSON.stringify({ time: '5m', content: '安全审计' }),
    ctx,
    ['web_search', 'group_remind']
  );
  assert.match(allowedRes, /已成功设定提醒/);

  // 3. 错误参数 JSON 格式防御
  const invalidJsonRes = await executeToolCall(
    'group_remind',
    'invalid-json-string{',
    ctx,
    ['group_remind']
  );
  assert.match(invalidJsonRes, /\[错误\] 工具参数格式不正确/);
});

test('getToolsForChat and toOpenAiTools generate valid function calling schemas', () => {
  const tools = getToolsForChat('sample_group@chatroom', false);
  assert.ok(tools.length >= 3);
  const toolNames = tools.map((t) => t.name);
  assert.ok(toolNames.includes('web_search'));
  assert.ok(toolNames.includes('group_remind'));
  assert.ok(toolNames.includes('palace_memo'));

  const openAiSchemas = toOpenAiTools(tools);
  assert.equal(openAiSchemas.length, tools.length);
  assert.equal(openAiSchemas[0].type, 'function');
  assert.ok(openAiSchemas[0].function.name);
  assert.ok(openAiSchemas[0].function.description);
  assert.ok(openAiSchemas[0].function.parameters);
});

test('webSearchTool executes live search query and returns structured text', async () => {
  const ctx = {
    chatId: 'sample_search@chatroom',
    senderWxid: 'wxid_test',
    senderName: '测试员',
    isGroup: true,
    isAdmin: false,
  };
  const res = await webSearchTool.execute({ query: 'Node.js' }, ctx);
  assert.ok(typeof res === 'string');
  assert.match(res, /搜索“Node\.js”/);
});
