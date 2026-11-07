const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(new URL('../content-scripts/usage-state.js', `file://${__filename}`), 'utf8');
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
