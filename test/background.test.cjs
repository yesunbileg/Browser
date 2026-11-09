const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const base = path.resolve(__dirname, '../AIWise');
const STORE = 'aiwise.accountRecords';

function setup(initial = {}) {
  let now = new Date(2026, 10, 9, 20, 0).getTime();
  const values = structuredClone(initial), alarms = new Map(), notices = [];
  const handlers = {};
  class FakeDate extends Date { static now() { return now; } }
  const chrome = {
    storage: { local: {
      async get(keys) { if (keys === null) return structuredClone(values); return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in values).map(k => [k, structuredClone(values[k])])); },
      async set(items) { Object.assign(values, structuredClone(items)); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; },
    } },
    runtime: { onMessage: { addListener(fn) { handlers.message = fn; } }, onStartup: { addListener() {} }, onInstalled: { addListener() {} } },
    alarms: { async create(name, options) { alarms.set(name, options); }, async clear(name) { return alarms.delete(name); }, onAlarm: { addListener(fn) { handlers.alarm = fn; } } },
    notifications: { async create(id, options) { notices.push({ id, ...options }); } },
  };
  const sandbox = { chrome, Date: FakeDate, console, setTimeout, clearTimeout };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  sandbox.importScripts = (...names) => names.forEach(name => vm.runInContext(fs.readFileSync(path.join(base, name), 'utf8'), context));
  vm.runInContext(fs.readFileSync(path.join(base, 'aiwise-patch/background.js'), 'utf8'), context);
  const message = (type, account, reset) => new Promise(resolve => {
    const accepted = handlers.message({ type, account, reset, observedAt: now }, { url: 'https://claude.ai/new' }, resolve);
    if (accepted !== true) resolve({ rejected: true });
  });
  return { values, alarms, notices, handlers, message, advance(ms) { now += ms; }, now: () => now };
}

test('migration and simultaneous updates preserve all accounts in one storage record', async () => {
  const h = setup({ 'aiwise.account.old': { accountId: 'old', accountName: 'Old', status: 'unknown' } });
  await Promise.all([
    h.message('AIWISE_ACCOUNT_SEEN', { id: 'a', name: 'A' }),
    h.message('AIWISE_ACCOUNT_SEEN', { id: 'b', name: 'B' }),
  ]);
  assert.deepEqual(Object.keys(h.values[STORE]).sort(), ['a', 'b', 'old']);
});

test('reset alarm gives a deduplicated likely-available notice, then success confirms availability', async () => {
  const h = setup();
  const resetAt = h.now() + 60_000;
  assert.equal((await h.message('AIWISE_CONFIRMED_LIMIT', { id: 'a', name: 'A' }, { source: 'network', resetAt })).ok, true);
  assert.equal(h.values[STORE].a.resetAt, resetAt);
  assert.equal(h.values[STORE].a.status, 'exhausted');
  const name = [...h.alarms.keys()][0];
  assert.ok(name);
  h.advance(61_000);
  await h.handlers.alarm({ name });
  await h.handlers.alarm({ name });
  assert.equal(h.values[STORE].a.status, 'likely_available');
  assert.equal(h.notices.filter(n => n.title.includes('Reset')).length, 1);
  await h.message('AIWISE_AVAILABLE', { id: 'a', name: 'A' });
  assert.equal(h.values[STORE].a.status, 'available');
  assert.equal(h.alarms.size, 0);
});

test('notification preferences suppress alerts without suppressing stored state', async () => {
  const h = setup({ notificationSettings: { enabled: false } });
  await h.message('AIWISE_CONFIRMED_LIMIT', { id: 'a', name: 'A' }, { source: 'network', resetAt: h.now() + 60_000 });
  h.advance(61_000);
  await h.handlers.alarm({ name: [...h.alarms.keys()][0] });
  assert.equal(h.values[STORE].a.status, 'likely_available');
  assert.equal(h.notices.length, 0);
});

test('a repeated stale observation after reset cannot replay notifications', async () => {
  const h = setup();
  const resetAt = h.now() + 60_000;
  const evidence = { source: 'network', resetAt };
  await h.message('AIWISE_CONFIRMED_LIMIT', { id: 'a', name: 'A' }, evidence);
  h.advance(61_000);
  const name = [...h.alarms.keys()][0];
  await h.handlers.alarm({ name });
  await h.message('AIWISE_CONFIRMED_LIMIT', { id: 'a', name: 'A' }, evidence);
  await h.handlers.alarm({ name });
  assert.equal(h.values[STORE].a.status, 'likely_available');
  assert.equal(h.notices.length, 2);
});
