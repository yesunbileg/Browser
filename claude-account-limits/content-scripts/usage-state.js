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
    return {
      accountId: account.id,
      accountName: account.name || 'Claude account',
      status: 'exhausted',
      resetLabel: reset.label,
      resetAt: resetTimestamp(reset, observedAt, previous),
      lastSeenAt: observedAt,
    };
  }

  root.AIWiseUsageState = { storageKey, accountName, resetTimestamp, recordForObservation };
})(globalThis);
