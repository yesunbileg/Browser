(function (root) {
  const bannerPattern = /^You are out of free messages until (\d{1,2}):(\d{2})\s*(AM|PM|A\.?M\.?|P\.?M\.?)?$/i;

  function parseResetBanner(text) {
    if (typeof text !== 'string') return null;
    const match = text.trim().replace(/\s+/g, ' ').match(bannerPattern);
    if (!match) return null;
    const rawHour = Number(match[1]);
    const minute = Number(match[2]);
    const meridiemText = match[3] ? match[3].replace(/\./g, '').toUpperCase() : null;
    if (minute > 59) return null;

    let hour = rawHour;
    if (meridiemText) {
      if (rawHour < 1 || rawHour > 12) return null;
      hour = rawHour % 12 + (meridiemText === 'PM' ? 12 : 0);
    } else if (rawHour > 23) return null;
    const label = `${rawHour}:${match[2]}${meridiemText ? ` ${meridiemText}` : ''}`;
    return { hour, minute, label };
  }

  function getResetTimestamp(reset, now, previous) {
    if (!reset || !Number.isInteger(reset.hour) || reset.hour < 0 || reset.hour > 23
      || !Number.isInteger(reset.minute) || reset.minute < 0 || reset.minute > 59
      || !(now instanceof Date) || !Number.isFinite(now.getTime())) return null;
    if (previous && previous.resetLabel === reset.label && Number.isFinite(previous.resetAt)) return previous.resetAt;

    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), reset.hour, reset.minute, 0, 0);
    const delta = now.getTime() - target.getTime();
    // Keep a just-passed clock time as unverified evidence. Older times mean
    // the banner most likely names the next local occurrence.
    if (delta > 0 && delta <= 5 * 60_000) return target.getTime();
    if (delta > 5 * 60_000) target.setDate(target.getDate() + 1);
    return target.getTime();
  }

  root.AIWiseFreeLimitParser = { parseResetBanner, getResetTimestamp };
})(globalThis);
