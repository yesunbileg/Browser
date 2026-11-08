const list = document.getElementById('accounts');
const total = document.getElementById('account-total');
const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
const panels = tabs.map((tab) => document.getElementById(tab.getAttribute('aria-controls')));
const prefix = 'aiwise.account.';
const staleAfterMs = 24 * 60 * 60 * 1000;
const usageState = globalThis.AIWiseUsageState;
const validTime = (value) => Number.isFinite(value) && Math.abs(value) <= 8.64e15;

tabs.forEach((tab, selectedIndex) => {
  tab.addEventListener('click', () => {
    tabs.forEach((item, index) => {
      const selected = index === selectedIndex;
      item.setAttribute('aria-selected', String(selected));
      panels[index].hidden = !selected;
    });
  });
});

function element(tag, className, text) {
  const result = document.createElement(tag);
  result.className = className;
  if (text) result.textContent = text;
  return result;
}

function countdown(resetAt, now) {
  const seconds = Math.max(0, Math.floor((resetAt - now) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

function progressFor(record, now) {
  const value = usageState.observedWaitProgress(record, now);
  const wrap = element('div', 'progress-wrap');
  const caption = element('div', 'progress-caption');
  caption.append(element('span', '', 'Wait progress'));
  caption.append(element('span', '', value === null ? 'Timer only' : `${value}%`));
  const track = element('div', `progress-track${value === null ? ' unmeasured' : ''}`);
  if (value === null) {
    track.setAttribute('aria-hidden', 'true');
  } else {
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', 'Observed cooldown elapsed');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', String(value));
    track.setAttribute('aria-valuetext', `${value}% of the observed wait elapsed`);
    const fill = element('div', 'progress-fill');
    fill.style.width = `${value}%`;
    track.append(fill);
  }
  wrap.append(caption, track);
  return wrap;
}

function cardFor(record, now) {
  const card = element('article', 'account');
  const head = element('div', 'card-head');
  head.append(element('h2', 'name', record.accountName || 'Claude account'));
  const exhausted = record.status === 'exhausted';
  head.append(element('span', `badge${exhausted ? '' : ' unknown'}`, exhausted ? 'Exhausted' : 'Unknown'));
  card.append(head);

  const lastSeen = validTime(record.lastSeenAt) ? record.lastSeenAt : null;
  const stale = lastSeen === null || now - lastSeen > staleAfterMs;
  if (exhausted && validTime(record.resetAt)) {
    if (record.resetAt > now) {
      card.append(element('p', 'status', 'Free messages exhausted'));
      card.append(element('time', 'countdown', countdown(record.resetAt, now)));
      const reset = element('p', 'reset-label', `Reset at ${record.resetLabel || new Date(record.resetAt).toLocaleTimeString()}`);
      reset.dateTime = new Date(record.resetAt).toISOString();
      card.append(reset, progressFor(record, now));
    } else {
      card.append(element('p', 'status', `Reset time passed (${record.resetLabel || 'unknown'})`));
      card.append(element('p', 'meta', 'Access remains unverified.'));
      card.append(progressFor(record, now));
    }
  } else if (exhausted) {
    card.append(element('p', 'status', 'Free messages exhausted'));
    card.append(element('p', 'meta', 'Reset time unavailable · access remains unverified.'));
    card.append(progressFor(record, now));
  } else {
    card.append(element('p', 'status', 'No confirmed limit observed'));
  }

  if (lastSeen !== null) {
    const date = new Date(lastSeen);
    card.append(element('p', 'meta', `${stale ? 'Stale · ' : ''}Last observed ${date.toLocaleString()}`));
  } else {
    card.append(element('p', 'meta', 'Stale · no observation time saved'));
  }
  return card;
}

async function render() {
  const now = Date.now();
  const stored = await chrome.storage.local.get(null);
  const records = Object.entries(stored)
    .filter(([key, value]) => key.startsWith(prefix) && value && typeof value.accountId === 'string')
    .map(([, value]) => value)
    .sort((a, b) => Number(b.status === 'exhausted') - Number(a.status === 'exhausted')
      || (a.accountName || '').localeCompare(b.accountName || ''));
  total.textContent = `${records.length} ${records.length === 1 ? 'account' : 'accounts'}`;
  list.replaceChildren();
  if (records.length === 0) {
    list.append(element('p', 'empty', 'Open Claude in a tab to check its signed-in account.'));
    return;
  }
  records.forEach((record) => list.append(cardFor(record, now)));
}

void render();
chrome.storage.onChanged.addListener(() => void render());
window.setInterval(() => void render(), 30_000);
