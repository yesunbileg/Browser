async function verifyDonor() {
  const response = await fetch(chrome.runtime.getURL('aiwise-patch/donor-lock.json'));
  if (!response.ok) throw new Error('Donor lock unavailable');
  const lock = await response.json();
  if (chrome.runtime.getManifest().version !== lock.extensionVersion) throw new Error('Unsupported extension version');
  for (const [file, expected] of Object.entries(lock.files)) {
    const asset = await fetch(chrome.runtime.getURL(file));
    if (!asset.ok) throw new Error('Donor asset missing');
    const digest = await crypto.subtle.digest('SHA-256', await asset.arrayBuffer());
    const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (actual !== expected) throw new Error('Unsupported donor asset');
  }
}

async function startAccountArea() {
  const root = document.getElementById('app');
  if (!root) return;
  await verifyDonor();
  const STORE = 'aiwise.accountRecords';
  const host = document.createElement('section');
  host.id = 'aiwise-confirmed-claude-limits';
  host.className = 'aiwise-limit-root';
  host.setAttribute('aria-live', 'polite');
  host.innerHTML = '<h2 class="aiwise-limit-title">Claude accounts</h2><div data-account-list class="aiwise-limit-list"></div>';
  const styles = document.createElement('style');
  styles.textContent = `
    .aiwise-limit-root { margin: 0; color: var(--aiwise-fg, #f4f4f5); font: inherit; }
    .aiwise-donor-limit-hidden { display: none !important; }
    .aiwise-limit-title { margin: 0 0 8px; color: var(--aiwise-fg, #f4f4f5); font-size: 12px; font-weight: 650; }
    .aiwise-limit-list { display: grid; gap: 8px; }
    .aiwise-limit-card { padding: 10px 11px; border: 1px solid var(--aiwise-border, #333338); border-radius: 9px; background: var(--aiwise-bg-soft, #202024); }
    .aiwise-limit-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .aiwise-limit-name { min-width: 0; margin: 0; color: var(--aiwise-fg, #f4f4f5); font-size: 12px; font-weight: 650; overflow-wrap: anywhere; }
    .aiwise-limit-badge { flex: 0 0 auto; padding: 3px 7px; border-radius: 999px; color: var(--aiwise-muted, #9ca3af); background: var(--aiwise-bg, #29292e); font-size: 10px; font-weight: 650; }
    .aiwise-limit-badge.exhausted { color: #fed7aa; background: #3a2b21; }
    .aiwise-limit-status { margin: 8px 0 0; color: var(--aiwise-muted, #9ca3af); font-size: 11px; }
    .aiwise-limit-countdown { display: block; margin-top: 2px; color: var(--aiwise-fg, #f4f4f5); font-size: 19px; font-variant-numeric: tabular-nums; font-weight: 700; line-height: 1.2; }
    .aiwise-limit-progress { height: 6px; margin-top: 8px; overflow: hidden; border-radius: 999px; background: var(--aiwise-track, #29292e); }
    .aiwise-limit-fill { height: 100%; border-radius: inherit; background: #4ade80; }
    .aiwise-limit-meta { margin: 7px 0 0; color: var(--aiwise-subtle, #9ca3af); font-size: 10px; }
    .aiwise-limit-empty { margin: 0; padding: 10px 11px; border: 1px solid var(--aiwise-border, #333338); border-radius: 9px; background: var(--aiwise-bg-soft, #202024); color: var(--aiwise-muted, #9ca3af); font-size: 11px; }
  `;
  document.head.append(styles);
  const list = host.querySelector('[data-account-list]');
  let active = true;

  const make = (tag, classes, text) => {
    const node = document.createElement(tag);
    node.className = classes;
    if (text) node.textContent = text;
    return node;
  };
  const validTime = (value) => Number.isFinite(value) && Math.abs(value) <= 8.64e15;
  const countdown = (resetAt, now) => {
    const minutes = Math.max(0, Math.floor((resetAt - now) / 60000));
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
  };

  function card(record, now) {
    const cardNode = make('article', 'aiwise-limit-card');
    const heading = make('div', 'aiwise-limit-heading');
    heading.append(make('h3', 'aiwise-limit-name', record.accountName || 'Claude account'));
    const exhausted = record.status === 'exhausted';
    const likely = record.status === 'likely_available';
    const available = record.status === 'available';
    heading.append(make('span', `aiwise-limit-badge${exhausted ? ' exhausted' : ''}`, exhausted ? 'Exhausted' : likely ? 'Check Claude' : available ? 'Available' : 'Unknown'));
    cardNode.append(heading);
    if (exhausted && validTime(record.resetAt) && record.resetAt > now) {
      cardNode.append(make('p', 'aiwise-limit-status', 'Free messages exhausted'));
      const time = make('time', 'aiwise-limit-countdown', countdown(record.resetAt, now));
      time.dateTime = new Date(record.resetAt).toISOString();
      cardNode.append(time, make('p', 'mt-0.5 mb-0 text-[11px] text-(--aiwise-muted,#9ca3af)', `Reset at ${record.resetLabel || new Date(record.resetAt).toLocaleTimeString()} · access unverified`));
      const progress = globalThis.AIWiseUsageState?.observedWaitProgress(record, now);
      if (progress !== null && progress !== undefined) {
        const track = make('div', 'aiwise-limit-progress');
        track.setAttribute('role', 'progressbar');
        track.setAttribute('aria-label', 'Observed cooldown elapsed');
        track.setAttribute('aria-valuemin', '0');
        track.setAttribute('aria-valuemax', '100');
        track.setAttribute('aria-valuenow', String(progress));
        const fill = make('div', 'aiwise-limit-fill');
        fill.style.width = `${progress}%`;
        track.append(fill);
        cardNode.append(track, make('p', 'aiwise-limit-meta', 'Observed wait progress'));
      }
    } else if (exhausted) {
      cardNode.append(make('p', 'aiwise-limit-status', validTime(record.resetAt)
        ? `Reset time passed (${record.resetLabel || 'unknown'}) · access unverified`
        : 'Free messages exhausted · reset time unavailable · access unverified'));
    } else if (likely) {
      cardNode.append(make('p', 'aiwise-limit-status', 'Reset time reached. Free messages may be available. Check Claude to confirm.'));
    } else if (available) {
      cardNode.append(make('p', 'aiwise-limit-status', 'Confirmed by a successful Claude response'));
    } else {
      cardNode.append(make('p', 'aiwise-limit-status', 'No confirmed limit observed'));
    }
    const seen = validTime(record.lastSeenAt) ? new Date(record.lastSeenAt).toLocaleString() : 'unknown';
    cardNode.append(make('p', 'aiwise-limit-meta', `Last observed ${seen}`));
    return cardNode;
  }

  async function render() {
    const all = await chrome.storage.local.get(STORE);
    const records = Object.values(all[STORE] || {})
      .filter(value => value && typeof value.accountId === 'string')
      .sort((a, b) => Number(b.status === 'exhausted') - Number(a.status === 'exhausted') || (a.accountName || '').localeCompare(b.accountName || ''));
    list.replaceChildren();
    if (!records.length) {
      list.append(make('p', 'aiwise-limit-empty', 'Open Claude in a tab to check its signed-in account.'));
    } else {
      records.forEach((record) => list.append(card(record, Date.now())));
    }
    syncVisibility();
  }

  function syncVisibility() {
    host.hidden = !active;
  }
  function detectProviderTab() {
    const buttons = Array.from(root.querySelectorAll('button'));
    const claude = buttons.find((button) => button.textContent.trim() === 'Claude');
    const gemini = buttons.find((button) => button.textContent.trim() === 'Gemini');
    if (claude && gemini) {
      active = claude.className.includes('bg-(--aiwise-tab-active,#fff)');
      const tabRow = claude.parentElement;
      const wrapper = tabRow.parentElement;
      if (host.parentElement !== wrapper || host.previousElementSibling !== tabRow) tabRow.after(host);
      const refresh = Array.from(wrapper.querySelectorAll('button')).find((button) => button.title === 'Refresh');
      let refreshRow = refresh;
      while (refreshRow && refreshRow.parentElement !== wrapper) refreshRow = refreshRow.parentElement;
      let afterTabs = false;
      for (const child of wrapper.children) {
        if (child === tabRow) { afterTabs = true; continue; }
        if (!afterTabs || child === host || child === refreshRow) continue;
        const hide = active;
        if (child.classList.contains('aiwise-donor-limit-hidden') !== hide) child.classList.toggle('aiwise-donor-limit-hidden', hide);
      }
      syncVisibility();
    } else {
      active = false;
      syncVisibility();
    }
  }

  const observer = new MutationObserver(() => {
    detectProviderTab();
    if (!host.isConnected) syncVisibility();
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes[STORE]) void render(); });
  window.setInterval(() => void render(), 30_000);
  detectProviderTab();
  void render();
}
void startAccountArea().catch(() => {
  const alert = document.createElement('p');
  alert.setAttribute('role', 'alert');
  alert.textContent = 'This AIWise build does not match the pinned donor. Reload the verified extension.';
  (document.querySelector('#app > div') || document.getElementById('app')).append(alert);
});
