importScripts('content-scripts/usage-state.js');

const state = globalThis.AIWiseUsageState;
const queues = new Map();

function enqueue(key, operation) {
  const previous = queues.get(key) || Promise.resolve();
  const next = previous.then(operation, operation);
  const queued = next.finally(() => {
    if (queues.get(key) === queued) queues.delete(key);
  });
  queues.set(key, queued);
  return next;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !['AIWISE_CONFIRMED_LIMIT', 'AIWISE_ACCOUNT_SEEN'].includes(message.type) || !message.account || typeof message.account.id !== 'string') return false;
  const account = { id: message.account.id, name: message.account.name };
  const key = state.storageKey(account.id);
  enqueue(key, async () => {
    const stored = await chrome.storage.local.get(key);
    const previous = stored[key];
    const observedAt = Number.isFinite(message.observedAt) ? message.observedAt : Date.now();
    if (message.type === 'AIWISE_ACCOUNT_SEEN') {
      const record = {
        ...(previous || {}),
        accountId: account.id,
        accountName: account.name || (previous && previous.accountName) || 'Claude account',
        status: previous && previous.status === 'exhausted' ? 'exhausted' : 'unknown',
        lastSeenAt: observedAt,
      };
      await chrome.storage.local.set({ [key]: record });
      sendResponse({ ok: true });
      return;
    }
    const record = state.recordForObservation(account, message.reset, observedAt, previous);
    await chrome.storage.local.set({ [key]: record });
    if (!previous || previous.status !== 'exhausted') {
      await chrome.notifications.create(`aiwise-limit-${encodeURIComponent(account.id)}`, {
        type: 'basic',
        iconUrl: 'icon/128.png',
        title: 'Claude free messages exhausted',
        message: `${record.accountName}: reset at ${record.resetLabel}. Access remains unverified until Claude clears the message.`,
      });
    }
    sendResponse({ ok: true });
  }).catch(() => sendResponse({ ok: false }));
  return true;
});
