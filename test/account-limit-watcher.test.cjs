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
    location: { hostname: 'claude.ai' },
    Date: FakeDate,
    URL,
    HTMLElement: Element,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    document: {
      documentElement: {},
      querySelectorAll(selector) {
        if (selector === 'a[href]') return bannerVisible ? [anchor] : [];
        if (selector.startsWith('[data-testid="chat-input"]')) return [composer];
        return [];
      },
    },
    MutationObserver: class { constructor(callback) { observerCallback = callback; } observe() {} },
    window: { setInterval: () => 1, setTimeout: () => 1 },
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
    settle: async () => { await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => setImmediate(resolve)); },
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
