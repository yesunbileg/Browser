const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const watcherSource = fs.readFileSync(new URL('../AIWise/aiwise-patch/account-limit-watcher.js', `file://${__filename}`), 'utf8');

function setup(firstResponse) {
  let now = 1_800_000_000_000;
  let bannerVisible = false;
  let observerCallback;
  const responses = [firstResponse];
  const requests = [];
  const messages = [];
  const timers = new Map();
  let nextTimer = 0;
  const events = {};
  class FakeDate extends Date { static now() { return now; } }
  class Element {
    constructor(text = '') { this.innerText = text; this.parentElement = null; this.href = ''; }
    getBoundingClientRect() { return { top: 0, bottom: 20, left: 0, right: 300, width: 300, height: 20 }; }
  }
  const banner = new Element('You are out of free messages until 8:20 PM messages');
  const anchor = new Element('messages');
  anchor.href = 'https://support.claude.com/en/articles/11647753-understanding-usage-and-length-limits';
  anchor.parentElement = banner;
  const composer = new Element();
  const sandbox = {
    globalThis: {},
    location: { hostname: 'claude.ai', origin: 'https://claude.ai' },
    Date: FakeDate,
    URL,
    HTMLElement: Element,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    document: {
      documentElement: {},
      visibilityState: 'visible',
      addEventListener(name, handler) { events[name] = handler; },
      querySelectorAll(selector) {
        if (selector.includes('11647753-understanding-usage-and-length-limits')) return bannerVisible ? [anchor] : [];
        if (selector.startsWith('[data-testid="chat-input"]')) return [composer];
        return [];
      },
    },
    MutationObserver: class { constructor(callback) { observerCallback = callback; } observe() {} },
    window: {
      addEventListener(name, handler) { events[name] = handler; },
      setTimeout: (callback) => { const id = ++nextTimer; timers.set(id, callback); return id; },
      clearTimeout: (id) => timers.delete(id),
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      const item = responses.shift();
      if (item instanceof Error) throw item;
      return { ok: true, json: async () => item };
    },
    chrome: {
      runtime: {
        lastError: null,
        sendMessage: (message, callback) => { messages.push(message); if (callback) callback(); },
      },
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.AIWiseFreeLimitParser = {
    parseResetBanner: (text) => text === 'You are out of free messages until 8:20 PM messages' ? { label: '8:20 PM', hour: 20, minute: 20 } : null,
  };
  sandbox.AIWiseUsageState = { accountName: (data) => data.display_name || data.email_address || 'Claude account' };
  vm.runInNewContext(watcherSource, sandbox);
  return {
    messages,
    requests,
    responses,
    setNow: (value) => { now = value; },
    advance: (delta) => { now += delta; },
    showBanner: () => { bannerVisible = true; observerCallback(); },
    hideBanner: () => { bannerVisible = false; observerCallback(); },
    network: (detail) => events.message({source: sandbox.window, origin: 'https://claude.ai', data: {source: 'aiwise-local-network', ...detail}}),
    settle: async () => {
      await new Promise((resolve) => setImmediate(resolve));
      for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test('a same-tab account switch cannot attach the old observation to the new account', async () => {
  const mock = setup({ uuid: 'account-a', display_name: 'Account A' });
  await mock.settle();

  mock.advance(6_000);
  mock.responses.push({ uuid: 'account-b', display_name: 'Account B' });
  mock.showBanner();
  await mock.settle();
  assert.equal(mock.messages.some((message) => message.type === 'AIWISE_CONFIRMED_LIMIT'), false);

  mock.advance(6_000);
  mock.responses.push({ uuid: 'account-b', display_name: 'Account B' });
  mock.showBanner();
  await mock.settle();
  const limit = mock.messages.find((message) => message.type === 'AIWISE_CONFIRMED_LIMIT');
  assert.equal(limit.account.id, 'account-b');
  assert.equal(limit.account.name, 'Account B');
  assert.ok(mock.requests.every((request) => request.url === '/api/account' && request.options.credentials === 'include'));
});

test('a failed identity refresh suppresses limit writes', async () => {
  const mock = setup({ uuid: 'account-a', display_name: 'Account A' });
  await mock.settle();
  mock.advance(6_000);
  mock.responses.push(new Error('offline'));
  mock.showBanner();
  await mock.settle();
  assert.equal(mock.messages.some((message) => message.type === 'AIWISE_CONFIRMED_LIMIT'), false);
});

test('repeated mutations for the same account and reset do not refetch identity', async () => {
  const mock = setup({ uuid: 'account-a', display_name: 'Account A' });
  await mock.settle();
  mock.advance(6_000);
  mock.responses.push({ uuid: 'account-a', display_name: 'Account A' });
  mock.showBanner();
  await mock.settle();
  const requestsAfterEvidence = mock.requests.length;
  mock.showBanner();
  await mock.settle();
  assert.equal(mock.requests.length, requestsAfterEvidence);
  assert.equal(mock.messages.filter((message) => message.type === 'AIWISE_CONFIRMED_LIMIT').length, 1);
});

test('a banner that disappears re-arms the same clock label as a new cycle', async () => {
  const identity = { uuid: 'a', display_name: 'A' };
  const mock = setup(identity);
  await mock.settle();
  mock.responses.push(identity);
  mock.showBanner();
  await mock.settle();
  mock.hideBanner();
  await mock.settle();
  mock.advance(24 * 3600_000);
  mock.responses.push(identity);
  mock.showBanner();
  await mock.settle();
  const limits = mock.messages.filter(m => m.type === 'AIWISE_CONFIRMED_LIMIT');
  assert.equal(limits.length, 2);
  assert.equal(limits[1].reset.newCycle, true);
});

test('network evidence is bound to a fresh account organization membership', async () => {
  const identity = { uuid: 'a', display_name: 'A', memberships: [{ organization: { uuid: 'org-a' } }] };
  const mock = setup(identity);
  await mock.settle();
  mock.responses.push(identity);
  mock.network({type: 'limit', orgId: 'org-other', resetAt: 1_900_000_000_000});
  await mock.settle();
  assert.equal(mock.messages.some(m => m.type === 'AIWISE_CONFIRMED_LIMIT'), false);
  mock.responses.push(identity);
  mock.network({type: 'limit', orgId: 'org-a', resetAt: 1_900_000_000_000});
  await mock.settle();
  const limit = mock.messages.find(m => m.type === 'AIWISE_CONFIRMED_LIMIT');
  assert.equal(limit.account.id, 'a');
  assert.equal(limit.reset.source, 'network');
  assert.equal(limit.reset.resetAt, 1_900_000_000_000);
});
