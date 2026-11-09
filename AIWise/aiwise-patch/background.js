importScripts('aiwise-patch/free-limit-parser.js', 'aiwise-patch/usage-state.js');

(() => {
  'use strict';
  const STORE = 'aiwise.accountRecords';
  const ALARM_PREFIX = 'aiwise-account-reset:';
  const state = globalThis.AIWiseUsageState;
  const validTime = value => Number.isFinite(value) && value > 0 && value <= 8.64e15;
  let queue = Promise.resolve();
  const serialize = operation => {
    const result = queue.then(operation, operation);
    queue = result.catch(() => {});
    return result;
  };

  async function read() {
    const stored = await chrome.storage.local.get([STORE, 'notificationSettings']);
    return { records: stored[STORE] || {}, preferences: stored.notificationSettings || {} };
  }
  async function save(records) { await chrome.storage.local.set({ [STORE]: records }); }
  const alarmName = id => ALARM_PREFIX + encodeURIComponent(id);
  async function schedule(record) {
    if (record.status === 'exhausted' && validTime(record.resetAt)) {
      await chrome.alarms.create(alarmName(record.accountId), { when: Math.max(Date.now() + 100, record.resetAt) });
    } else {
      await chrome.alarms.clear(alarmName(record.accountId));
    }
  }
  async function notify(id, title, message) {
    try { await chrome.notifications.create(id, { type: 'basic', iconUrl: 'icon/128.png', title, message }); }
    catch { /* Notification permission does not affect saved observations. */ }
  }
  async function initialize() {
    const stored = await chrome.storage.local.get(STORE);
    let records = stored[STORE];
    if (!records || typeof records !== 'object' || Array.isArray(records)) {
      records = {};
      // One-time migration only. Normal events and the popup read one known key.
      const all = await chrome.storage.local.get(null);
      const legacy = [];
      for (const [key, value] of Object.entries(all)) {
        if (key.startsWith('aiwise.account.') && value && typeof value.accountId === 'string') {
          records[value.accountId] = value;
          legacy.push(key);
        }
      }
      await save(records);
      if (legacy.length) await chrome.storage.local.remove(legacy);
    }
    for (const record of Object.values(records)) await schedule(record);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!['AIWISE_ACCOUNT_SEEN', 'AIWISE_CONFIRMED_LIMIT', 'AIWISE_AVAILABLE'].includes(message?.type)) return false;
    if (typeof message.account?.id !== 'string' || !message.account.id.trim() || message.account.id.length > 256) return false;
    if (!sender?.url?.startsWith('https://claude.ai/')) return false;
    const account = { id: message.account.id.trim(), name: String(message.account.name || 'Claude account').slice(0, 256) };
    serialize(async () => {
      const { records, preferences } = await read();
      const previous = records[account.id];
      const observedAt = validTime(message.observedAt) ? Math.min(message.observedAt, Date.now()) : Date.now();
      if (previous?.lastSeenAt > observedAt) return;
      let record;
      if (message.type === 'AIWISE_ACCOUNT_SEEN') {
        record = { ...previous, accountId: account.id, accountName: account.name, status: previous?.status || 'unknown', lastSeenAt: observedAt };
      } else if (message.type === 'AIWISE_AVAILABLE') {
        record = { ...previous, accountId: account.id, accountName: account.name, status: 'available', resetAt: null, resetLabel: null, lastSeenAt: observedAt, lastConfirmedAt: observedAt };
      } else {
        if (!message.reset || typeof message.reset !== 'object') throw new Error('Missing reset evidence');
        record = state.recordForObservation(account, message.reset, observedAt, previous);
        if (!validTime(record.resetAt)) throw new Error('Invalid reset evidence');
      }
      records[account.id] = record;
      await save(records);
      await schedule(record);
      const newLimit = record.status === 'exhausted' && (previous?.status !== 'exhausted' || previous?.resetAt !== record.resetAt);
      if (newLimit && preferences.enabled !== false && preferences.session?.[100] !== false) {
        await notify(`aiwise-limit-${encodeURIComponent(account.id)}`, 'Claude free messages exhausted', `${account.name}: reset at ${record.resetLabel}.`);
      }
    }).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  });

  chrome.alarms.onAlarm.addListener(alarm => {
    if (!alarm.name.startsWith(ALARM_PREFIX)) return;
    return serialize(async () => {
      let id;
      try { id = decodeURIComponent(alarm.name.slice(ALARM_PREFIX.length)); } catch { return; }
      const { records, preferences } = await read();
      const record = records[id];
      if (!record || record.status !== 'exhausted' || !validTime(record.resetAt)) return;
      if (record.resetAt > Date.now()) { await schedule(record); return; }
      const alreadyNotified = record.resetNotifiedFor === record.resetAt;
      records[id] = { ...record, status: 'likely_available', resetNotifiedFor: record.resetAt };
      await save(records);
      await chrome.alarms.clear(alarm.name);
      if (!alreadyNotified && preferences.enabled !== false && preferences.resetNotice !== false) {
        await notify(`aiwise-reset-${encodeURIComponent(id)}`, 'Reset time reached', `${record.accountName}: free messages may be available again. Check Claude to confirm.`);
      }
    });
  });
  chrome.runtime.onStartup.addListener(() => void serialize(initialize));
  chrome.runtime.onInstalled.addListener(() => void serialize(initialize));
  void serialize(initialize);
})();
