import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogManager, formatQuoteReply } from '../dist/dialog.js';
import { matchHardCommand } from '../dist/commands.js';

test('formatQuoteReply formats group messages with mandatory quote bubble and @mention', () => {
  const formatted = formatQuoteReply({
    senderName: '张三',
    sourceText: '@Nox 帮我写个Python脚本',
    replyText: '好的，这是Python脚本。',
    isGroup: true,
  });

  assert.equal(
    formatted,
    '「张三：帮我写个Python脚本」\n- - - - - - - - - - - - - - -\n@张三 好的，这是Python脚本。'
  );
});

test('formatQuoteReply preserves private chat reply without quote bubble', () => {
  const formatted = formatQuoteReply({
    senderName: '李四',
    sourceText: '你好',
    replyText: '你好！有什么可以帮你的？',
    isGroup: false,
  });

  assert.equal(formatted, '你好！有什么可以帮你的？');
});

test('formatQuoteReply handles long snippets by truncating at 35 characters', () => {
  const longSource = '@Nox 这个任务要求非常复杂而且很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长';
  const formatted = formatQuoteReply({
    senderName: '王五',
    sourceText: longSource,
    replyText: '收到',
    isGroup: true,
  });

  assert.match(formatted, /「王五：.{35}\.\.\.」/);
});

test('formatQuoteReply provides fallback text when source text is empty', () => {
  const formatted = formatQuoteReply({
    senderName: '',
    sourceText: '',
    replyText: '已处理',
    isGroup: true,
  });

  assert.equal(
    formatted,
    '「群友：图片/消息」\n- - - - - - - - - - - - - - -\n@群友 已处理'
  );
});

test('dialogManager records ambient group background messages', () => {
  const chatId = 'test_group_bg@chatroom';
  dialogManager.recordGroupBackground(chatId, '小明', '今天下午三点开会');
  dialogManager.recordGroupBackground(chatId, '小红', '好的收到');

  const bg = dialogManager.getGroupBackground(chatId);
  assert.match(bg, /小明: 今天下午三点开会/);
  assert.match(bg, /小红: 好的收到/);
});

test('dialogManager records multi-turn history and respects session TTL', () => {
  const chatId = 'test_dialog_chat';
  dialogManager.resetSession(chatId);

  dialogManager.appendTurn(chatId, {
    role: 'user',
    content: '第一步是什么？',
    sender: '提问者',
    timestamp: Date.now(),
  });
  dialogManager.appendTurn(chatId, {
    role: 'assistant',
    content: '第一步是需求分析。',
    timestamp: Date.now(),
  });

  const turns = dialogManager.getTurns(chatId);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].content, '第一步是什么？');
  assert.equal(turns[1].content, '第一步是需求分析。');

  const remainingTtl = dialogManager.getRemainingTtlSec(chatId);
  assert.ok(remainingTtl > 890 && remainingTtl <= 900);

  // 显式重置
  dialogManager.resetSession(chatId);
  assert.equal(dialogManager.getTurns(chatId).length, 0);
  assert.equal(dialogManager.getRemainingTtlSec(chatId), 0);
});

test('matchHardCommand correctly matches commands with mentions, spaces, and Unicode spaces', () => {
  const c1 = matchHardCommand('@Nox /help');
  assert.ok(c1);
  assert.equal(c1.cmdName, 'help');

  const c2 = matchHardCommand('@Nox /help');
  assert.ok(c2);
  assert.equal(c2.cmdName, 'help');

  const c3 = matchHardCommand('@Nox/help');
  assert.ok(c3);
  assert.equal(c3.cmdName, 'help');

  const c4 = matchHardCommand('@机器人助手 /status');
  assert.ok(c4);
  assert.equal(c4.cmdName, 'status');

  const c5 = matchHardCommand('/new');
  assert.ok(c5);
  assert.equal(c5.cmdName, 'new');

  const c6 = matchHardCommand('@Nox 你好啊');
  assert.equal(c6, null);
});
