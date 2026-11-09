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
  const identityThrottleMs = 5_000;

  function noteAccount(current, observedAt) {
    chrome.runtime.sendMessage({ type: 'AIWISE_ACCOUNT_SEEN', account: current, observedAt });
  }

  async function refreshIdentity(requireFresh = false) {
    if (identityRequest) return identityRequest;
    const now = Date.now();
    if (identityCheckedAt && now - identityCheckedAt < identityThrottleMs) {
      return requireFresh ? null : { account, changed: false };
    }
    identityCheckedAt = now;
    identityRequest = (async () => {
      try {
        const response = await fetch('/api/account', { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('Claude account lookup failed');
        const data = await response.json();
        if (typeof data.uuid !== 'string' || !data.uuid.trim()) throw new Error('Claude account identity is missing');
        const next = { id: data.uuid.trim(), name: state.accountName(data) };
        const changed = Boolean(account && account.id !== next.id);
        account = next;
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
    for (const anchor of document.querySelectorAll('a[href]')) {
      let url;
      try { url = new URL(anchor.href); } catch { continue; }
      if (!isVisible(anchor) || url.origin !== 'https://support.claude.com' || url.pathname !== supportPath || anchor.innerText.trim() !== 'messages') continue;
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
    if (pending) return;
    if (!findConfirmedBanner()) return;
    pending = true;
    void refreshIdentity(true).then((identity) => {
      if (!identity) {
        window.setTimeout(scan, identityThrottleMs);
        return;
      }
      if (identity.changed) return;
      // Recheck after the identity request so a banner from the previous account
      // cannot be attached to a newly signed-in account during a SPA switch.
      const reset = findConfirmedBanner();
      if (!reset) return;
      chrome.runtime.sendMessage({
        type: 'AIWISE_CONFIRMED_LIMIT',
        account: identity.account,
        reset,
        observedAt: Date.now(),
      }, () => {
        void chrome.runtime.lastError;
      });
    }).finally(() => {
      pending = false;
    });
  }

  const observer = new MutationObserver(() => {
    if (account) scan();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'style', 'class'] });
  void refreshIdentity().then(() => scan());
  window.setInterval(() => { void refreshIdentity().then(() => scan()); }, 60_000);
})();
