const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeExpiry, zonedDateTimeToIso } = require('../lib/time');

test('converts a Berlin summer timestamp to UTC', () => {
  assert.equal(zonedDateTimeToIso('2027-08-12', '19:53', 'Europe/Berlin'), '2027-08-12T17:53:00.000Z');
});

test('converts the NewzBay-style local timestamp using Berlin winter time', () => {
  assert.equal(zonedDateTimeToIso('2027-03-08', '16:33', 'Europe/Berlin'), '2027-03-08T15:33:00.000Z');
});

test('keeps an explicitly UTC timestamp unchanged', () => {
  assert.equal(zonedDateTimeToIso('2027-08-12', '19:53', 'UTC'), '2027-08-12T19:53:00.000Z');
});

test('rejects a nonexistent local time during the DST jump', () => {
  assert.equal(zonedDateTimeToIso('2027-03-28', '02:30', 'Europe/Berlin'), null);
});

test('keeps legacy date-only reminders valid', () => {
  assert.deepEqual(normalizeExpiry({ expiresAt: '2027-03-08' }), { expiresAt: '2027-03-08', expiresTime: '', timeZone: '', expiresAtUtc: '' });
});
