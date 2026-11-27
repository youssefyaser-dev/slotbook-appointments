import test from 'node:test';
import assert from 'node:assert/strict';
import { toMin, toHHMM, isDate, weekday, addDays, freeSlots } from '../server/slots.js';

test('time conversion round trips and rejects junk', () => {
  assert.equal(toMin('09:30'), 570); assert.equal(toHHMM(570), '09:30'); assert.equal(toHHMM(0), '00:00');
  assert.ok(Number.isNaN(toMin('9:30'))); assert.ok(Number.isNaN(toMin('')));
});
test('date validation catches impossible dates', () => {
  assert.ok(isDate('2026-02-28')); assert.ok(!isDate('2026-02-30')); assert.ok(!isDate('2026-2-3')); assert.ok(isDate('2028-02-29')); assert.ok(!isDate('2027-02-29'));
});
test('weekday and addDays cross month and year edges', () => {
  assert.equal(weekday('2026-11-29'), 0); assert.equal(weekday('2026-11-30'), 1);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01'); assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});
test('slots fit the service inside working hours on a grid', () => {
  assert.deepEqual(freeSlots({ workStart: 540, workEnd: 600, minutes: 30, busy: [] }), [540, 555, 570]);
  assert.deepEqual(freeSlots({ workStart: 540, workEnd: 600, minutes: 60, busy: [] }), [540]);
  assert.deepEqual(freeSlots({ workStart: 540, workEnd: 560, minutes: 30, busy: [] }), []);
});
test('busy intervals block overlaps but allow back-to-back', () => {
  const busy = [{ start_min: 570, end_min: 600 }];
  assert.deepEqual(freeSlots({ workStart: 540, workEnd: 660, minutes: 30, busy }), [540, 600, 615, 630]);
});
test('slots already past today are hidden', () => {
  assert.deepEqual(freeSlots({ workStart: 540, workEnd: 600, minutes: 15, busy: [], nowMin: 560 }), [570, 585]);
});
