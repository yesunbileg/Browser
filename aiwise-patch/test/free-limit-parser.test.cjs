const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(new URL('../patch/free-limit-parser.js', `file://${__filename}`), 'utf8');
const context = { globalThis: {}, Date };
vm.runInNewContext(source, context);
const { parseResetBanner, getResetTimestamp } = context.globalThis.AIWiseFreeLimitParser;

test('parses the visible free-message banner text with a local PM reset', () => {
  const result = parseResetBanner('You are out of free messages until 8:20 PM', new Date(2026, 10, 7, 19, 0));
  assert.equal(result?.hour, 20);
  assert.equal(result?.minute, 20);
  assert.equal(getResetTimestamp(result, new Date(2026, 10, 7, 19, 0)), new Date(2026, 10, 7, 20, 20).getTime());
});

test('rolls a just-after-midnight reset into the next local day', () => {
  const now = new Date(2026, 10, 7, 23, 50);
  const result = parseResetBanner('You are out of free messages until 12:10 AM', now);
  assert.equal(getResetTimestamp(result, now), new Date(2026, 10, 8, 0, 10).getTime());
});

test('rejects unrelated text, malformed times, and unsupported hours', () => {
  assert.equal(parseResetBanner('You are out of free messages', new Date()), null);
  assert.equal(parseResetBanner('You are out of free messages until 8:20', new Date()), null);
  assert.equal(parseResetBanner('You are out of free messages until 13:20 PM', new Date()), null);
  assert.equal(parseResetBanner('You are out of free messages until 8:20 PM. Try again', new Date()), null);
});

test('an already-passed local reset stays passed instead of rolling to tomorrow', () => {
  const now = new Date(2026, 10, 7, 20, 21);
  const result = parseResetBanner('You are out of free messages until 8:20 PM', now);
  assert.equal(getResetTimestamp(result, now), new Date(2026, 10, 7, 20, 20).getTime());
});
