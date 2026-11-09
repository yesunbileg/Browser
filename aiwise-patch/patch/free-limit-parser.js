(function (root) {
  const bannerPattern = /^You are out of free messages until (\d{1,2}):(\d{2})\s*(AM|PM)$/i;

  function parseResetBanner(text) {
    if (typeof text !== 'string') return null;
    const match = text.trim().replace(/\s+/g, ' ').match(bannerPattern);
    if (!match) return null;

    const rawHour = Number(match[1]);
    const minute = Number(match[2]);
    if (rawHour < 1 || rawHour > 12 || minute > 59) return null;

    const meridiem = match[3].toUpperCase();
    return {
      hour: rawHour % 12 + (meridiem === 'PM' ? 12 : 0),
      minute,
      label: `${rawHour}:${match[2]} ${meridiem}`,
    };
  }

  function getResetTimestamp(reset, now) {
    if (!reset || !(now instanceof Date) || !Number.isFinite(now.getTime())) return null;
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), reset.hour, reset.minute, 0, 0);
    // A near-midnight banner can name a reset just after midnight. Only infer
    // tomorrow for that narrow case; otherwise a passed time remains passed.
    if (target.getTime() <= now.getTime() && now.getHours() >= 23 && reset.hour < 2) {
      target.setDate(target.getDate() + 1);
    }
    return target.getTime();
  }

  root.AIWiseFreeLimitParser = { parseResetBanner, getResetTimestamp };
})(globalThis);
