const test = require('node:test');
const assert = require('node:assert/strict');
const { isCompletionUrl, parseLimitPayload, installNetworkCapture } = require('../AIWise/aiwise-patch/network-capture.js');

// Synthetic fixtures exercise the capture contract; they do not claim to be provider payload samples.
const ORIGIN = 'https://claude.ai';
const ORG = 'org-123';
const RESET = 1_900_000_000_000;

function response(body, { status = 429, type = 'application/json' } = {}) {
  return new Response(body, { status, headers: { 'content-type': type } });
}

test('captures only exact same-origin completion and retry completion routes', () => {
  assert.equal(isCompletionUrl(`${ORIGIN}/api/organizations/${ORG}/chat_conversations/c1/completion`), ORG);
  assert.equal(isCompletionUrl(`${ORIGIN}/api/organizations/${ORG}/chat_conversations/c1/retry_completion?x=1`), ORG);
  for (const url of [
    'https://evil.test/api/organizations/org/chat_conversations/c/completion',
    `${ORIGIN}/api/organizations/o/chat_conversations/c/other`,
    `${ORIGIN}/api/organizations/o/chat_conversations/c/completion/extra`,
    `${ORIGIN}/api/organizations/o/chat_conversations/c/completionish`,
  ]) assert.equal(isCompletionUrl(url), null);
});

test('accepts explicit reset fields and normalizes seconds, milliseconds, and ISO', () => {
  assert.deepEqual(parseLimitPayload({ type: 'message_limit', resetsAt: RESET / 1000 }), { resetAt: RESET });
  assert.deepEqual(parseLimitPayload({ windows: [{ status: 'exceeded_limit', resets_at: RESET }] }), { resetAt: RESET });
  assert.deepEqual(parseLimitPayload({ windows: [{ status: 'available', resetsAt: RESET }, { status: 'exceeded_limit', resetsAt: RESET + 5000 }] }), { resetAt: RESET + 5000 });
  assert.deepEqual(parseLimitPayload({ windows: [{ status: 'exceeded_limit', resetsAt: RESET + 5000 }, { status: 'exceeded_limit', resetsAt: RESET + 10000 }] }), { resetAt: RESET + 10000 });
  assert.deepEqual(parseLimitPayload({ error: { message: JSON.stringify({ message_limit: { reset_at: new Date(RESET).toISOString() } }) } }), { resetAt: RESET });
});

test('rejects malformed, prose-only, unmarked, and unbounded timestamps', () => {
  for (const value of [
    { resetsAt: RESET },
    { type: 'message_limit', resetsAt: 'tomorrow at 8' },
    { type: 'message_limit', resetsAt: 0 },
    { type: 'message_limit', resetsAt: 99_999_999_999_999 },
    { windows: [{ status: 'available', resetsAt: RESET }] },
    { error: { message: 'limit resets at 1900000000' } },
  ]) assert.equal(parseLimitPayload(value), null);
});

test('HTTP 429 treats plain and nested structured reset fields as limit evidence', async () => {
  async function capture(payload) {
    const events = [];
    const win = { fetch: async () => response(JSON.stringify(payload)), postMessage: (data) => events.push(data), location: { origin: ORIGIN } };
    installNetworkCapture(win);
    await win.fetch(`${ORIGIN}/api/organizations/${ORG}/chat_conversations/c/completion`);
    await new Promise((resolve) => setImmediate(resolve));
    return events;
  }
  assert.deepEqual(await capture({ resetsAt: RESET }), [{ source: 'aiwise-local-network', type: 'limit', orgId: ORG, resetAt: RESET }]);
  assert.deepEqual(await capture({ error: { message: JSON.stringify({ resetsAt: RESET / 1000 }) } }), [{ source: 'aiwise-local-network', type: 'limit', orgId: ORG, resetAt: RESET }]);
  assert.deepEqual(await capture({ error: { message: { resets_at: RESET } } }), [{ source: 'aiwise-local-network', type: 'limit', orgId: ORG, resetAt: RESET }]);
});

test('emits normalized limit from HTTP 429 without changing the original response', async () => {
  const events = [];
  const original = response(JSON.stringify({ windows: [{ status: 'exceeded_limit', resetsAt: RESET }] }));
  const win = { fetch: async () => original, postMessage: (data, origin) => events.push({ data, origin }), location: { origin: ORIGIN } };
  installNetworkCapture(win);
  const returned = await win.fetch(`${ORIGIN}/api/organizations/${ORG}/chat_conversations/c/completion`);
  assert.equal(returned, original);
  assert.equal(await returned.clone().text(), JSON.stringify({ windows: [{ status: 'exceeded_limit', resetsAt: RESET }] }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events.map(({ data }) => data), [{ source: 'aiwise-local-network', type: 'limit', orgId: ORG, resetAt: RESET }]);
  assert.equal(events[0].origin, ORIGIN);
});

test('does not infer limit from HTTP 200 JSON and ignores unrelated fetches', async () => {
  const events = [];
  const win = { fetch: async () => response(JSON.stringify({ windows: [{ status: 'exceeded_limit', resetsAt: RESET }] }), { status: 200 }), postMessage: (data) => events.push(data), location: { origin: ORIGIN } };
  installNetworkCapture(win);
  await win.fetch(`${ORIGIN}/api/organizations/${ORG}/chat_conversations/c/completion`);
  await win.fetch(`${ORIGIN}/api/other`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, []);
});

test('requires message_stop for available and suppresses it when stream has limit error', async () => {
  async function capture(sse) {
    const events = [];
    const win = { fetch: async () => response(sse, { status: 200, type: 'text/event-stream' }), postMessage: (data) => events.push(data), location: { origin: ORIGIN } };
    installNetworkCapture(win);
    await win.fetch(`${ORIGIN}/api/organizations/${ORG}/chat_conversations/c/completion`);
    await new Promise((resolve) => setImmediate(resolve));
    return events;
  }
  assert.deepEqual(await capture('event: message_stop\ndata: {"type":"message_stop"}\n\n'), [
    { source: 'aiwise-local-network', type: 'available', orgId: ORG },
  ]);
  assert.deepEqual(await capture('data: {"type":"message_limit","message_limit":{"resetsAt":1900000000}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n'), [
    { source: 'aiwise-local-network', type: 'limit', orgId: ORG, resetAt: RESET },
  ]);
  assert.deepEqual(await capture('data: {"type":"message_stop"}\n\n'), [
    { source: 'aiwise-local-network', type: 'available', orgId: ORG },
  ]);
  assert.deepEqual(await capture('data: {"windows":[{"status":"exceeded_limit"}]}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n'), []);
  assert.deepEqual(await capture('event: message_stop\ndata: {"type":"message_stop"}\n\nevent: error\ndata: {"type":"error","error":{"message":"synthetic failure"}}\n\n'), []);
});


test('emits identity-changed without forwarding identity values', async () => {
  const events = [];
  const replies = [response('{"uuid":"account-one"}', { status: 200 }), response('{"uuid":"account-two"}', { status: 200 })];
  const win = { fetch: async () => replies.shift(), postMessage: (data) => events.push(data), location: { origin: ORIGIN } };
  installNetworkCapture(win);
  await win.fetch(`${ORIGIN}/api/account`);
  await win.fetch(`${ORIGIN}/api/account`, { method: 'GET' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [{ source: 'aiwise-local-network', type: 'identity-changed' }]);
});
