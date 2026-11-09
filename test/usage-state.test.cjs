const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(new URL('../AIWise/aiwise-patch/usage-state.js', `file://${__filename}`), 'utf8');
const context = { globalThis: {} };
vm.runInNewContext(source, context);
const state = context.globalThis.AIWiseUsageState;

test('account labels use Claude display-name fallbacks', () => {
  assert.equal(state.accountName({ display_name: 'Ada', full_name: 'Ada Lovelace', email_address: 'ada@example.test' }), 'Ada');
  assert.equal(state.accountName({ full_name: 'Ada Lovelace' }), 'Ada Lovelace');
  assert.equal(state.accountName({ email_address: 'ada@example.test' }), 'ada@example.test');
  assert.equal(state.accountName({}), 'Claude account');
});

test('storage keys isolate accounts', () => {
  assert.notEqual(state.storageKey('account-1'), state.storageKey('account-2'));
  assert.match(state.storageKey('id/with spaces'), /%2F/);
});

test('records preserve a passed reset for a repeated stale banner', () => {
  const firstObserved = new Date(2026, 10, 7, 19, 0).getTime();
  const previous = state.recordForObservation({ id: 'a', name: 'Ada' }, { label: '8:20 PM', hour: 20, minute: 20 }, firstObserved);
  const nextMorning = new Date(2026, 10, 8, 9, 0).getTime();
  const repeated = state.recordForObservation({ id: 'a', name: 'Ada' }, { label: '8:20 PM', hour: 20, minute: 20 }, nextMorning, previous);
  assert.equal(repeated.resetAt, previous.resetAt);
  assert.equal(repeated.status, 'exhausted');
});

test('different reset evidence gets a new local timestamp', () => {
  const now = new Date(2026, 10, 7, 19, 0).getTime();
  const record = state.recordForObservation({ id: 'b', name: 'Grace' }, { label: '9:10 PM', hour: 21, minute: 10 }, now);
  assert.equal(record.resetAt, new Date(2026, 10, 7, 21, 10).getTime());
});

test('first observed cooldown timestamp is preserved across the same reset', () => {
  const firstObserved = 1_000_000;
  const reset = { label: '8:20 PM', hour: 20, minute: 20 };
  const first = state.recordForObservation({ id: 'a', name: 'Ada' }, reset, firstObserved);
  const repeated = state.recordForObservation({ id: 'a', name: 'Ada' }, reset, firstObserved + 60_000, first);
  assert.equal(repeated.limitObservedAt, first.limitObservedAt);
  assert.equal(state.observedWaitProgress(first, firstObserved), 0);
  assert.equal(state.observedWaitProgress(first, first.resetAt), 100);
});

test('observed wait progress clamps before start and after reset', () => {
  const record = { limitObservedAt: 1_000, resetAt: 5_000 };
  assert.equal(state.observedWaitProgress(record, 0), 0);
  assert.equal(state.observedWaitProgress(record, 7_000), 100);
});

test('records without a valid observed interval remain unmeasured', () => {
  assert.equal(state.observedWaitProgress({ resetAt: 5_000 }, 2_000), null);
  assert.equal(state.observedWaitProgress({ limitObservedAt: 5_000, resetAt: 5_000 }, 5_000), null);
  assert.equal(state.observedWaitProgress({ limitObservedAt: 8_000, resetAt: 5_000 }, 7_000), null);
});
