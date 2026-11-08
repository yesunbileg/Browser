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
    if (previous && previous.resetLabel === reset.label && Number.isFinite(previous.resetAt) && previous.resetAt < observedAt) {
      return previous.resetAt;
    }
    const now = new Date(observedAt);
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), reset.hour, reset.minute, 0, 0);
    if (target.getTime() <= observedAt && now.getHours() >= 23 && reset.hour < 2) target.setDate(target.getDate() + 1);
    return target.getTime();
  }

  function recordForObservation(account, reset, observedAt, previous) {
    const resetAt = resetTimestamp(reset, observedAt, previous);
    const sameReset = previous && previous.resetLabel === reset.label && previous.resetAt === resetAt;
    return {
      accountId: account.id,
      accountName: account.name || 'Claude account',
      status: 'exhausted',
      resetLabel: reset.label,
      resetAt,
      limitObservedAt: sameReset && Number.isFinite(previous.limitObservedAt)
        ? previous.limitObservedAt
        : observedAt,
      lastSeenAt: observedAt,
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
