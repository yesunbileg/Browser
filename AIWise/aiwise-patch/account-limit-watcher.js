(() => {
  'use strict';

  const supportPath = '/en/articles/11647753-understanding-usage-and-length-limits';
  const parser = globalThis.AIWiseFreeLimitParser;
  const state = globalThis.AIWiseUsageState;
  if (!parser || !state || location.hostname !== 'claude.ai') return;

  let account = null;
  let identityCheckedAt = 0;
  let identityRequest = null;
  let pending = false;
  let scanTimer = null;
  let lastBannerKey = null;
  let bannerCycleEnded = false;
  let ignoreCurrentBanner = false;
  const identityThrottleMs = 5_000;
  const scanDebounceMs = 300;

  function noteAccount(current, observedAt) {
    chrome.runtime.sendMessage({ type: 'AIWISE_ACCOUNT_SEEN', account: { id: current.id, name: current.name }, observedAt });
  }

  async function refreshIdentity(requireFresh = false) {
    if (identityRequest) return identityRequest;
    const now = Date.now();
    if (!requireFresh && identityCheckedAt && now - identityCheckedAt < identityThrottleMs) {
      return requireFresh ? null : { account, changed: false };
    }
    identityCheckedAt = now;
    identityRequest = (async () => {
      try {
        const response = await fetch('/api/account', { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('Claude account lookup failed');
        const data = await response.json();
        if (typeof data.uuid !== 'string' || !data.uuid.trim()) throw new Error('Claude account identity is missing');
        const next = {
          id: data.uuid.trim(),
          name: state.accountName(data),
          orgIds: Array.isArray(data.memberships) ? data.memberships.map((membership) => {
            const organization = membership && membership.organization;
            return organization && typeof organization.uuid === 'string'
              ? organization.uuid
              : membership && typeof membership.organization_uuid === 'string' ? membership.organization_uuid : null;
          }).filter(Boolean) : [],
        };
        const changed = Boolean(account && account.id !== next.id);
        account = next;
        if (changed) {
          lastBannerKey = null;
          bannerCycleEnded = false;
          ignoreCurrentBanner = false;
        }
        noteAccount(next, Date.now());
        return { account: next, changed };
      } catch {
        // Do not attribute evidence to the last known account when identity cannot be confirmed.
        account = null;
        return null;
      } finally {
        identityRequest = null;
      }
    })();
    return identityRequest;
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  }

  function nearComposer(banner) {
    const bannerRect = banner.getBoundingClientRect();
    return Array.from(document.querySelectorAll('[data-testid="chat-input"][role="textbox"]')).some((control) => {
      if (!isVisible(control)) return false;
      const rect = control.getBoundingClientRect();
      return Math.max(0, bannerRect.top - rect.bottom, rect.top - bannerRect.bottom) <= 420 &&
        Math.max(0, bannerRect.left - rect.right, rect.left - bannerRect.right) <= 900;
    });
  }

  function findConfirmedBanner() {
    for (const anchor of document.querySelectorAll(`a[href*="${supportPath}"]`)) {
      let url;
      try { url = new URL(anchor.href); } catch { continue; }
      if (url.origin !== 'https://support.claude.com' || url.pathname !== supportPath || anchor.innerText.trim() !== 'messages' || !isVisible(anchor)) continue;
      let element = anchor.parentElement;
      for (let depth = 0; element && depth < 4; depth += 1, element = element.parentElement) {
        if (!isVisible(element) || !nearComposer(element)) continue;
        const reset = parser.parseResetBanner(element.innerText);
        if (reset) return reset;
      }
    }
    return null;
  }

  function scan() {
    scanTimer = null;
    if (pending) return;
    const visibleReset = findConfirmedBanner();
    if (!visibleReset) {
      if (lastBannerKey || ignoreCurrentBanner) bannerCycleEnded = true;
      lastBannerKey = null;
      ignoreCurrentBanner = false;
      return;
    }
    if (ignoreCurrentBanner) return;
    if (account && `${account.id}:${visibleReset.label}` === lastBannerKey) return;
    pending = true;
    void refreshIdentity(true).then((identity) => {
      if (!identity) return;
      if (identity.changed) return;
      // Recheck after the identity request so a banner from the previous account
      // cannot be attached to a newly signed-in account during a SPA switch.
      const reset = findConfirmedBanner();
      if (!reset) return;
      const bannerKey = `${identity.account.id}:${reset.label}`;
      if (bannerKey === lastBannerKey) return;
      lastBannerKey = bannerKey;
      if (bannerCycleEnded) reset.newCycle = true;
      bannerCycleEnded = false;
      chrome.runtime.sendMessage({
        type: 'AIWISE_CONFIRMED_LIMIT',
        account: { id: identity.account.id, name: identity.account.name },
        reset,
        observedAt: Date.now(),
      }, () => {
        void chrome.runtime.lastError;
      });
    }).finally(() => {
      pending = false;
    });
  }

  function scheduleScan() {
    if (scanTimer !== null) window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scan, scanDebounceMs);
  }

  async function handleLocalNetworkEvent(event) {
    const detail = event && event.data;
    if (event.source !== window || event.origin !== location.origin || !detail
      || detail.source !== 'aiwise-local-network') return;
    if (detail.type === 'identity-changed') {
      refreshAndScan();
      return;
    }
    if (!['limit', 'available'].includes(detail.type) || typeof detail.orgId !== 'string') return;
    if (detail.type === 'limit' && (!Number.isFinite(detail.resetAt) || detail.resetAt <= 0)) return;
    const identity = await refreshIdentity(true);
    if (!identity || !identity.account.orgIds.includes(detail.orgId)) return;
    if (detail.type === 'available') {
      lastBannerKey = null;
      bannerCycleEnded = true;
      // A completed response can arrive before the old banner is removed.
      ignoreCurrentBanner = Boolean(findConfirmedBanner());
      chrome.runtime.sendMessage({ type: 'AIWISE_AVAILABLE', account: { id: identity.account.id, name: identity.account.name }, source: 'network' });
      return;
    }
    const reset = { resetAt: detail.resetAt, source: 'network', label: new Date(detail.resetAt).toLocaleString() };
    chrome.runtime.sendMessage({ type: 'AIWISE_CONFIRMED_LIMIT', account: { id: identity.account.id, name: identity.account.name }, reset, observedAt: Date.now() });
  }

  const observer = new MutationObserver(() => {
    if (account) scheduleScan();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'style', 'class'] });
  const refreshAndScan = () => { void refreshIdentity(true).then((identity) => { if (identity && !identity.changed) scheduleScan(); }); };
  void refreshIdentity().then(() => scheduleScan());
  for (const eventName of ['focus', 'pageshow', 'popstate', 'hashchange']) window.addEventListener?.(eventName, refreshAndScan);
  window.addEventListener?.('message', (event) => { void handleLocalNetworkEvent(event); });
  document.addEventListener?.('visibilitychange', () => { if (document.visibilityState === 'visible') refreshAndScan(); });
})();
