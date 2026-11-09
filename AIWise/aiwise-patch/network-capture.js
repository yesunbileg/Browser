(function (root) {
  'use strict';

  const ORIGIN = 'https://claude.ai';
  const JSON_LIMIT = 64 * 1024;
  const SSE_LIMIT = 2 * 1024 * 1024;
  // Prefer camelCase, then snake_case aliases; numeric values below 1e11 are epoch seconds.
  const RESET_KEYS = ['resetsAt', 'resets_at', 'reset_at'];
  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

  function isCompletionUrl(input) {
    let url;
    try { url = new URL(input, ORIGIN); } catch { return null; }
    if (url.origin !== ORIGIN) return null;
    const match = url.pathname.match(/^\/api\/organizations\/([^/]+)\/chat_conversations\/[^/]+\/(?:completion|retry_completion)$/);
    return match ? match[1] : null;
  }

  function normalizeReset(value) {
    let timestamp;
    if (typeof value === 'string') {
      if (/^\d{4}-\d\d-\d\dT/.test(value)) timestamp = Date.parse(value);
      else if (/^\d+(?:\.\d+)?$/.test(value)) timestamp = Number(value);
      else return null;
    } else if (typeof value === 'number' && Number.isFinite(value)) timestamp = value;
    else return null;
    if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
    if (timestamp < 1e11) timestamp *= 1000;
    // The upper bound rejects malformed magnitudes while allowing long reset windows.
    if (timestamp < 946684800000 || timestamp > 4102444800000) return null;
    return Math.trunc(timestamp);
  }

  function parseLimitPayload(payload, options = {}) {
    if (!payload || typeof payload !== 'object') return null;
    const queue = [{ item: payload, windowGroup: null }];
    const seen = new Set();
    const generalResets = [];
    const windowGroups = [];
    let limit = options.assumeLimit === true;
    while (queue.length && seen.size < 128) {
      const entry = queue.shift();
      const item = entry.item;
      if (!item || typeof item !== 'object' || seen.has(item)) continue;
      seen.add(item);
      if (item.type === 'message_limit' || item.status === 'exceeded_limit') limit = true;
      const ownReset = RESET_KEYS.map((key) => hasOwn(item, key) ? normalizeReset(item[key]) : null).find((value) => value !== null);
      if (ownReset !== undefined) {
        if (entry.windowGroup?.blocked) entry.windowGroup.resets.push(ownReset);
        else if (!entry.windowGroup) generalResets.push(ownReset);
      }
      if (item.message_limit && typeof item.message_limit === 'object') {
        limit = true;
        queue.push({ item: item.message_limit, windowGroup: entry.windowGroup });
      }
      if (Array.isArray(item.windows)) {
        for (const window of item.windows.slice(0, 32)) {
          const group = { blocked: window?.status === 'exceeded_limit', resets: [] };
          windowGroups.push(group);
          if (group.blocked) limit = true;
          queue.push({ item: window, windowGroup: group });
        }
      }
      if (item.error && typeof item.error === 'object') queue.push({ item: item.error, windowGroup: entry.windowGroup });
      if (item.message && typeof item.message === 'object') queue.push({ item: item.message, windowGroup: entry.windowGroup });
      if (typeof item.message === 'string' && item.message.length <= JSON_LIMIT) {
        try {
          const parsed = JSON.parse(item.message);
          if (parsed && typeof parsed === 'object') queue.push({ item: parsed, windowGroup: entry.windowGroup });
        } catch { /* prose is not reset evidence */ }
      }
    }
    if (!limit) return null;
    const blockingResets = windowGroups.flatMap((group) => group.blocked ? group.resets : []);
    const candidates = blockingResets.length ? blockingResets : generalResets;
    return candidates.length ? { resetAt: Math.max(...candidates) } : null;
  }

  function hasLimitIndicator(payload) {
    if (!payload || typeof payload !== 'object') return false;
    const queue = [payload];
    const seen = new Set();
    while (queue.length && seen.size < 128) {
      const item = queue.shift();
      if (!item || typeof item !== 'object' || seen.has(item)) continue;
      seen.add(item);
      if (item.type === 'message_limit' || item.status === 'exceeded_limit' || (item.message_limit && typeof item.message_limit === 'object')) return true;
      if (Array.isArray(item.windows)) queue.push(...item.windows.slice(0, 32));
      if (item.error && typeof item.error === 'object') queue.push(item.error);
      if (item.message && typeof item.message === 'object') queue.push(item.message);
      if (typeof item.message === 'string' && item.message.length <= JSON_LIMIT) {
        try { const parsed = JSON.parse(item.message); if (parsed && typeof parsed === 'object') queue.push(parsed); } catch { /* prose is not a limit indicator */ }
      }
    }
    return false;
  }

  async function readBoundedText(response, limit) {
    if (!response || !response.body) return null;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let text = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return text + decoder.decode();
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel();
          return null;
        }
        text += decoder.decode(value, { stream: true });
      }
    } catch {
      try { await reader.cancel(); } catch { /* ignore clone cleanup failures */ }
      return null;
    }
  }

  function inspectSse(text) {
    let sawStop = false;
    let sawError = false;
    let limit = null;
    const events = text.split(/\r?\n\r?\n/);
    for (const event of events) {
      let eventName = '';
      const dataLines = [];
      for (const line of event.split(/\r?\n/)) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (eventName === 'message_stop') sawStop = true;
      if (eventName.toLowerCase().includes('error')) sawError = true;
      if (!dataLines.length) continue;
      try {
        const payload = JSON.parse(dataLines.join('\n'));
        if (payload && payload.type === 'message_stop') sawStop = true;
        if (payload && (String(payload.type || '').toLowerCase().includes('error') || (payload.error !== undefined && payload.error !== null))) sawError = true;
        const found = parseLimitPayload(payload);
        if (found) limit = found;
        else if (hasLimitIndicator(payload)) limit = { invalid: true };
      } catch { /* ignore non-JSON event data */ }
    }
    return { sawStop, sawError, limit };
  }

  function installNetworkCapture(win) {
    if (!win || typeof win.fetch !== 'function' || win.__aiwiseNetworkCaptureInstalled) return;
    win.__aiwiseNetworkCaptureInstalled = true;
    const originalFetch = win.fetch;
    let accountId = null;

    function post(type, detail) {
      try { win.postMessage({ source: 'aiwise-local-network', type, ...detail }, win.location.origin); } catch { /* page teardown */ }
    }

    async function monitorCompletion(response, orgId) {
      try {
        if (response.status === 429) {
          const text = await readBoundedText(response.clone(), JSON_LIMIT);
          if (text === null) return;
          let payload;
          try { payload = JSON.parse(text); } catch { return; }
          const limit = parseLimitPayload(payload, { assumeLimit: true });
          if (limit) post('limit', { orgId, resetAt: limit.resetAt });
          return;
        }
        if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) return;
        const text = await readBoundedText(response.clone(), SSE_LIMIT);
        if (text === null) return;
        const result = inspectSse(text);
        if (result.limit) {
          if (result.limit.resetAt) post('limit', { orgId, resetAt: result.limit.resetAt });
          return;
        }
        if (result.sawStop && !result.sawError) post('available', { orgId });
      } catch { /* monitoring must never affect the page fetch */ }
    }

    async function monitorAccount(response) {
      try {
        if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('json')) return;
        const text = await readBoundedText(response.clone(), JSON_LIMIT);
        if (text === null) return;
        const payload = JSON.parse(text);
        const nextId = typeof payload?.uuid === 'string' && payload.uuid.trim() ? payload.uuid.trim() : null;
        if (!nextId) return;
        if (accountId !== null && accountId !== nextId) post('identity-changed', {});
        accountId = nextId;
      } catch { /* ignore non-identity and malformed responses */ }
    }

    win.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      try {
        const request = args[0];
        const rawUrl = request instanceof URL ? request.href : request && typeof request === 'object' && 'url' in request ? request.url : String(request || '');
        const url = new URL(rawUrl, win.location.origin);
        const orgId = isCompletionUrl(url.href);
        if (orgId) void monitorCompletion(response, orgId);
        else if (url.origin === ORIGIN && url.pathname === '/api/account' && String(args[1]?.method || request?.method || 'GET').toUpperCase() === 'GET') void monitorAccount(response);
      } catch { /* preserve fetch behavior even if observation fails */ }
      return response;
    };
  }

  const api = { isCompletionUrl, normalizeReset, parseLimitPayload, installNetworkCapture };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.window === root) installNetworkCapture(root);
})(typeof globalThis === 'object' ? globalThis : this);
