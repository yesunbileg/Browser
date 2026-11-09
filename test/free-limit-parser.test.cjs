const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(new URL('../AIWise/aiwise-patch/free-limit-parser.js', `file://${__filename}`), 'utf8');
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
  assert.equal(parseResetBanner('You are out of free messages until 24:20', new Date()), null);
  assert.equal(parseResetBanner('You are out of free messages until 13:20 PM', new Date()), null);
  assert.equal(parseResetBanner('You are out of free messages until 8:20 PM. Try again', new Date()), null);
});

test('an already-passed local reset stays passed instead of rolling to tomorrow', () => {
  const now = new Date(2026, 10, 7, 20, 21);
  const result = parseResetBanner('You are out of free messages until 8:20 PM', now);
  assert.equal(getResetTimestamp(result, now), new Date(2026, 10, 7, 20, 20).getTime());
});

test('resolves early morning reset hours to tomorrow when today is evening', () => {
  for (const [time, expected] of [['1:00 AM', [2026, 10, 8, 1, 0]], ['3:30 AM', [2026, 10, 8, 3, 30]]]) {
    const now = new Date(2026, 10, 7, 20, 0);
    const reset = parseResetBanner(`You are out of free messages until ${time}`);
    assert.equal(getResetTimestamp(reset, now), new Date(...expected).getTime());
  }
});

test('parses strict 24-hour times and punctuation spacing', () => {
  assert.equal(parseResetBanner('You are out of free messages until 0:05')?.hour, 0);
  assert.equal(parseResetBanner('You are out of free messages until 13:05')?.hour, 13);
  assert.equal(parseResetBanner('You are out of free messages until 12:05 a.m.')?.hour, 0);
  assert.equal(parseResetBanner('You are out of free messages until 12:05 p.m.')?.hour, 12);
});

test('rejects out-of-range 24-hour values and malformed meridiems', () => {
  for (const value of ['24:00', '9:60', '0:15 PM', '13:15 AM', '9:15 XM', '9:15 PM extra']) {
    assert.equal(parseResetBanner(`You are out of free messages until ${value}`), null);
  }
});

test('a passed clock stays passed within the five-minute grace window', () => {
  const now = new Date(2026, 10, 7, 20, 24);
  const reset = parseResetBanner('You are out of free messages until 8:20 PM');
  assert.equal(getResetTimestamp(reset, now), new Date(2026, 10, 7, 20, 20).getTime());
});

test('a stale same-label observation preserves the previous inferred reset epoch', () => {
  const previous = { resetAt: new Date(2026, 10, 7, 20, 20).getTime(), resetLabel: '8:20 PM' };
  const now = new Date(2026, 10, 8, 9, 0);
  const reset = parseResetBanner('You are out of free messages until 8:20 PM');
  assert.equal(getResetTimestamp(reset, now, previous), previous.resetAt);
});
