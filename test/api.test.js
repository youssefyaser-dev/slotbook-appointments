import test from 'node:test';
import assert from 'node:assert/strict';
import { start, MONDAY } from './helpers.js';

test('catalogue endpoints list services and providers, filterable by service', async () => {
  const s = await start();
  assert.equal((await s.call('GET', '/api/services')).body.length, 5);
  const all = (await s.call('GET', '/api/providers')).body;
  assert.equal(all.length, 4);
  const derm = (await s.call('GET', '/api/providers?service=3')).body;
  assert.deepEqual(derm.map((p) => p.name), ['Dr. Omar Khaled']);
  s.close();
});

test('availability respects hours, service length and existing bookings', async () => {
  const s = await start();
  let a = (await s.call('GET', `/api/availability?provider=1&service=1&date=${MONDAY}`)).body;
  assert.equal(a.slots[0], '09:00'); assert.equal(a.slots.at(-1), '16:15'); // 45 min visit must end by 17:00
  assert.equal((await s.book()).status, 201);
  a = (await s.call('GET', `/api/availability?provider=1&service=1&date=${MONDAY}`)).body;
  assert.ok(!a.slots.includes('09:00') && !a.slots.includes('09:30') && a.slots.includes('09:45'));
  s.close();
});

test('closed days, past days, far future and time off return empty slots with a reason', async () => {
  const s = await start();
  const get = async (d, p = 1) => (await s.call('GET', `/api/availability?provider=${p}&service=1&date=${d}`)).body;
  assert.equal((await get('2026-12-04')).reason, 'closed');   // Friday
  assert.equal((await get('2026-11-28')).reason, 'past');
  assert.equal((await get('2027-03-01')).reason, 'too_far');
  await s.call('POST', '/api/admin/time-off', { provider_id: 1, date: MONDAY }, s.admin);
  assert.equal((await get(MONDAY)).reason, 'time_off');
  s.close();
});

test('today hides slots in the next 30 minutes', async () => {
  const s = await start();
  s.clock.date = MONDAY; s.clock.minutes = 9 * 60 + 10;
  const a = (await s.call('GET', `/api/availability?provider=1&service=2&date=${MONDAY}`)).body;
  assert.equal(a.slots[0], '09:45');
  s.close();
});

test('availability validates its input', async () => {
  const s = await start();
  assert.equal((await s.call('GET', '/api/availability?provider=1&service=1&date=nope')).status, 400);
  assert.equal((await s.call('GET', `/api/availability?provider=99&service=1&date=${MONDAY}`)).status, 404);
  assert.equal((await s.call('GET', `/api/availability?provider=2&service=5&date=${MONDAY}`)).status, 400);
  s.close();
});

test('booking returns a private token and the details', async () => {
  const s = await start();
  const r = await s.book({ notes: 'First visit' });
  assert.equal(r.status, 201); assert.match(r.body.token, /^[\w-]{12}$/);
  assert.deepEqual([r.body.start, r.body.end, r.body.status], ['09:00', '09:45', 'booked']);
  const g = await s.call('GET', `/api/bookings/${r.body.token}`);
  assert.equal(g.body.service.name, 'Initial consultation'); assert.equal(g.body.provider.name, 'Dr. Nadia Hassan');
  assert.equal((await s.call('GET', '/api/bookings/doesnotexist1')).status, 404);
  s.close();
});

test('double booking and overlaps are rejected, even when sent at the same time', async () => {
  const s = await start();
  const results = await Promise.all([1, 2, 3, 4, 5].map((i) => s.book({ name: `Person ${i}` })));
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.ok(results.every((r) => [201, 409].includes(r.status)));
  assert.equal((await s.book({ time: '09:30', name: 'Overlap' })).status, 409);
  assert.equal((await s.book({ time: '09:45', name: 'Next' })).status, 201);
  s.close();
});

test('booking validation: name, phone, time, notes, json', async () => {
  const s = await start();
  assert.equal((await s.book({ name: 'x' })).status, 400);
  assert.equal((await s.book({ phone: 'call me' })).status, 400);
  assert.equal((await s.book({ time: '9am' })).status, 400);
  assert.equal((await s.book({ time: '08:00' })).status, 409);
  assert.equal((await s.book({ notes: 'n'.repeat(301) })).status, 400);
  assert.equal((await s.call('POST', '/api/bookings', '{bad')).status, 400);
  assert.equal((await s.call('POST', '/api/bookings', '[]')).status, 400);
  assert.equal((await s.call('POST', '/api/bookings', 'x'.repeat(25000))).status, 413);
  s.close();
});

test('cancel: frees the slot, needs two hours notice, only once', async () => {
  const s = await start();
  const b = (await s.book()).body;
  assert.equal((await s.call('DELETE', `/api/bookings/${b.token}`)).body.status, 'cancelled');
  assert.equal((await s.call('DELETE', `/api/bookings/${b.token}`)).status, 409);
  assert.equal((await s.book()).status, 201); // slot is free again
  const late = (await s.book({ time: '12:00', name: 'Late One' })).body;
  s.clock.date = MONDAY; s.clock.minutes = 10 * 60 + 30; // 90 minutes before
  assert.equal((await s.call('DELETE', `/api/bookings/${late.token}`)).status, 409);
  s.close();
});

test('admin endpoints require the key', async () => {
  const s = await start();
  assert.equal((await s.call('GET', '/api/admin/bookings')).status, 401);
  assert.equal((await s.call('GET', '/api/admin/bookings', undefined, { 'x-admin-key': 'wrong' })).status, 401);
  assert.equal((await s.call('GET', '/api/admin/bookings', undefined, s.admin)).status, 200);
  s.close();
});

test('admin can list a day, update status and see stats', async () => {
  const s = await start();
  const a = (await s.book()).body; await s.book({ time: '11:00', name: 'Second Person' });
  const day = (await s.call('GET', `/api/admin/bookings?date=${MONDAY}`, undefined, s.admin)).body;
  assert.deepEqual(day.map((b) => b.start), ['09:00', '11:00']);
  assert.equal((await s.call('PATCH', `/api/admin/bookings/${a.id}`, { status: 'completed' }, s.admin)).body.status, 'completed');
  assert.equal((await s.call('PATCH', `/api/admin/bookings/${a.id}`, { status: 'no_show' }, s.admin)).status, 409);
  assert.equal((await s.call('PATCH', `/api/admin/bookings/${a.id}`, { status: 'weird' }, s.admin)).status, 400);
  assert.deepEqual((await s.call('GET', '/api/admin/stats', undefined, s.admin)).body, { booked: 1, completed: 1 });
  s.close();
});

test('time off cannot be set over existing bookings', async () => {
  const s = await start(); await s.book();
  assert.equal((await s.call('POST', '/api/admin/time-off', { provider_id: 1, date: MONDAY }, s.admin)).status, 409);
  s.close();
});

test('rate limit on booking writes', async () => {
  const s = await start({ rateLimit: 3 });
  const codes = []; for (let i = 0; i < 5; i++) codes.push((await s.book({ time: '09:00', name: 'Spammer' })).status);
  assert.deepEqual(codes.slice(3), [429, 429]);
  s.close();
});

test('static files are served and path traversal is refused', async () => {
  const s = await start();
  assert.equal((await s.call('GET', '/')).status, 200);
  assert.equal((await s.call('GET', '/../server/app.js')).status, 404);
  assert.equal((await s.call('GET', '/%2e%2e/server/app.js')).status, 404);
  assert.equal((await s.call('GET', '/api/unknown')).status, 404);
  assert.equal((await s.call('PUT', '/nope', {})).status, 405);
  s.close();
});
