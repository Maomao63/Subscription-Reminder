const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function isTimeZone(value) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function partsInTimeZone(timestamp, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  return Object.fromEntries(formatter.formatToParts(timestamp)
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, Number(part.value)]));
}

function zonedDateTimeToIso(date, time, timeZone) {
  if (!DATE_PATTERN.test(date) || !TIME_PATTERN.test(time) || !isTimeZone(timeZone)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wanted = Date.UTC(year, month - 1, day, hour, minute, 0);
  let candidate = wanted;

  // Resolve the zone offset at the requested wall-clock time. A second pass
  // handles offset changes around daylight-saving transitions.
  for (let pass = 0; pass < 3; pass += 1) {
    const parts = partsInTimeZone(new Date(candidate), timeZone);
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    candidate += wanted - represented;
  }

  const result = new Date(candidate);
  const actual = partsInTimeZone(result, timeZone);
  if (actual.year !== year || actual.month !== month || actual.day !== day || actual.hour !== hour || actual.minute !== minute) return null;
  return result.toISOString();
}

function normalizeExpiry(input) {
  const expiresAt = String(input.expiresAt || '');
  const expiresTime = String(input.expiresTime || '');
  const timeZone = String(input.timeZone || '');
  if (!DATE_PATTERN.test(expiresAt)) return null;
  if (!expiresTime && !timeZone) return { expiresAt, expiresTime: '', timeZone: '', expiresAtUtc: '' };
  if (!TIME_PATTERN.test(expiresTime) || !isTimeZone(timeZone)) return null;
  const expiresAtUtc = zonedDateTimeToIso(expiresAt, expiresTime, timeZone);
  return expiresAtUtc ? { expiresAt, expiresTime, timeZone, expiresAtUtc } : null;
}

module.exports = { isTimeZone, normalizeExpiry, zonedDateTimeToIso };
