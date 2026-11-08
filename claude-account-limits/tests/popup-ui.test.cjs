const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(new URL('../popup.html', `file://${__filename}`), 'utf8');
const script = fs.readFileSync(new URL('../popup.js', `file://${__filename}`), 'utf8');

test('popup includes the AIWise menu header, account summary and Claude/Gemini tabs', () => {
  assert.match(html, /AIWise/);
  assert.match(html, /account-total/);
  assert.match(html, /Claude/);
  assert.match(html, /Gemini/);
  assert.match(html, /aria-selected="true"/);
});

test('unsupported Gemini tracking is clearly marked', () => {
  assert.match(html, /Gemini tracking is not configured/);
});

test('popup renders saved Claude account data in the Claude tab', () => {
  assert.match(script, /record\.accountName/);
  assert.match(script, /Free messages exhausted/);
  assert.match(script, /Reset at/);
  assert.match(script, /Access remains unverified/);
});

test('selecting Gemini switches panels without claiming Gemini data', () => {
  const listeners = [];
  const makeTab = (controls, selected) => ({
    attributes: { 'aria-controls': controls, 'aria-selected': String(selected) },
    addEventListener: (_event, callback) => listeners.push(callback),
    getAttribute(name) { return this.attributes[name]; },
    setAttribute(name, value) { this.attributes[name] = value; },
  });
  const tabs = [makeTab('claude-panel', true), makeTab('gemini-panel', false)];
  const panels = { 'claude-panel': { hidden: false }, 'gemini-panel': { hidden: true } };
  const accounts = { replaceChildren() {}, append() {} };
  const total = { textContent: '' };
  const context = {
    document: {
      getElementById: (id) => id === 'accounts' ? accounts : id === 'account-total' ? total : panels[id],
      querySelectorAll: () => tabs,
      createElement: () => ({ append() {}, setAttribute() {}, style: {}, textContent: '' }),
    },
    chrome: { storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } } },
    window: { setInterval() {} },
    globalThis: { AIWiseUsageState: { observedWaitProgress: () => null } },
    Date,
    Number,
    Object,
  };
  vm.runInNewContext(script, context);
  listeners[1]();
  assert.equal(tabs[0].attributes['aria-selected'], 'false');
  assert.equal(tabs[1].attributes['aria-selected'], 'true');
  assert.equal(panels['claude-panel'].hidden, true);
  assert.equal(panels['gemini-panel'].hidden, false);
});
