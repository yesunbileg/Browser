const list = document.getElementById('accounts');
const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
const panels = tabs.map((tab) => document.getElementById(tab.getAttribute('aria-controls')));
const prefix = 'aiwise.account.';
const staleAfterMs = 24 * 60 * 60 * 1000;

tabs.forEach((tab, selectedIndex) => {
  tab.addEventListener('click', () => {
    tabs.forEach((item, index) => {
      const selected = index === selectedIndex;
      item.setAttribute('aria-selected', String(selected));
      panels[index].hidden = !selected;
    });
  });
});

function line(className, text) {
  const element = document.createElement('p');
  element.className = className;
  element.textContent = text;
  return element;
}

function countdown(resetAt, now) {
  const seconds = Math.max(0, Math.floor((resetAt - now) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m remaining`;
}

function cardFor(record, now) {
  const card = document.createElement('section');
  card.className = 'account';
  card.append(line('name', record.accountName || 'Claude account'));

  const lastSeen = Number.isFinite(record.lastSeenAt) ? record.lastSeenAt : null;
  const stale = lastSeen === null || now - lastSeen > staleAfterMs;
  if (record.status === 'exhausted') {
    card.append(line('status', 'Free messages exhausted'));
    if (Number.isFinite(record.resetAt) && record.resetAt > now) {
      card.append(line('reset', `Reset at ${record.resetLabel} · ${countdown(record.resetAt, now)}`));
    } else {
      card.append(line('reset', `Reset time passed (${record.resetLabel || 'unknown'})`));
      card.append(line('meta', 'Access remains unverified.'));
    }
  } else {
    card.append(line('status', 'No confirmed limit observed'));
  }
  if (lastSeen !== null) {
    const date = new Date(lastSeen).toLocaleString();
    card.append(line('meta', `${stale ? 'Stale · ' : ''}Last observed ${date}`));
  } else {
    card.append(line('meta', 'Stale · no observation time saved'));
  }
  return card;
}

async function render() {
  const now = Date.now();
  const stored = await chrome.storage.local.get(null);
  const records = Object.entries(stored)
    .filter(([key, value]) => key.startsWith(prefix) && value && typeof value.accountId === 'string')
    .map(([, value]) => value)
    .sort((a, b) => (a.accountName || '').localeCompare(b.accountName || ''));
  list.replaceChildren();
  if (records.length === 0) {
    list.append(line('empty', 'Open Claude in a tab to check its signed-in account.'));
    return;
  }
  records.forEach((record) => list.append(cardFor(record, now)));
}

void render();
chrome.storage.onChanged.addListener(() => void render());
window.setInterval(() => void render(), 30_000);
