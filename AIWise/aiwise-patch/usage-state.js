(function (root) {
  'use strict';

  function storageKey(accountId) {
    return `aiwise.account.${encodeURIComponent(accountId)}`;
  }

  function accountName(account) {
    return [account && account.display_name, account && account.full_name, account && account.email_address]
      .find((value) => typeof value === 'string' && value.trim())?.trim() || 'Claude account';
  }

  function resetTimestamp(reset, observedAt, previous) {
    if (reset?.source === 'network' && Number.isFinite(reset.resetAt) && reset.resetAt > 0 && reset.resetAt <= 8.64e15) return reset.resetAt;
    // A visible -> absent -> visible banner is fresh evidence. Continuous stale
    // banners retain their old epoch; an unexpired network epoch still wins.
    if (reset?.newCycle && previous?.resetAt <= observedAt) previous = null;
    if (previous?.resetSource === 'network' && Number.isFinite(previous.resetAt)) {
      const old = new Date(previous.resetAt);
      if (previous.resetAt > observedAt || (old.getHours() === reset?.hour && old.getMinutes() === reset?.minute)) return previous.resetAt;
    }
    const parser = root.AIWiseFreeLimitParser;
    return parser ? parser.getResetTimestamp(reset, new Date(observedAt), previous) : null;
  }

  function recordForObservation(account, reset, observedAt, previous) {
    const resetAt = resetTimestamp(reset, observedAt, previous);
    const sameReset = previous && previous.resetAt === resetAt;
    return {
      accountId: account.id,
      accountName: account.name || 'Claude account',
      status: sameReset && previous?.status === 'likely_available' ? 'likely_available' : 'exhausted',
      resetLabel: sameReset && previous?.resetSource === 'network' && reset.source !== 'network'
        ? previous.resetLabel
        : reset.label || (Number.isFinite(resetAt) ? new Date(resetAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null),
      resetAt,
      resetSource: reset.source === 'network' || (sameReset && previous?.resetSource === 'network') ? 'network' : 'banner',
      limitObservedAt: sameReset && Number.isFinite(previous.limitObservedAt)
        ? previous.limitObservedAt
        : observedAt,
      lastSeenAt: observedAt,
      ...(sameReset && previous.resetNotifiedFor === resetAt ? { resetNotifiedFor: resetAt } : {}),
    };
  }

  function observedWaitProgress(record, now) {
    if (!record || !Number.isFinite(record.limitObservedAt) || !Number.isFinite(record.resetAt)
      || Math.abs(record.limitObservedAt) > 8.64e15 || Math.abs(record.resetAt) > 8.64e15
      || record.resetAt <= record.limitObservedAt) return null;
    const progress = (now - record.limitObservedAt) / (record.resetAt - record.limitObservedAt);
    return Math.round(Math.min(1, Math.max(0, progress)) * 100);
  }

  root.AIWiseUsageState = { storageKey, accountName, resetTimestamp, recordForObservation, observedWaitProgress };
})(globalThis);
