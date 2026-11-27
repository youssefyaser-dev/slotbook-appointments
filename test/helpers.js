import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { seedDemo } from '../server/seed.js';

// 2026-11-30 is a Monday. Clock is pinned to Sunday 2026-11-29 08:00.
export const MONDAY = '2026-11-30';
export async function start(opts = {}) {
  const db = openDb(); seedDemo(db);
  const clock = { date: '2026-11-29', minutes: 8 * 60 };
  const server = createApp(db, { adminKey: 'test-admin', now: () => clock, rateLimit: 1000, ...opts });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const text = await res.text(); let data = text; try { data = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, body: data, headers: res.headers };
  };
  const book = (extra = {}) => call('POST', '/api/bookings', { provider_id: 1, service_id: 1, date: MONDAY, time: '09:00', name: 'Sara Ali', phone: '+20 100 123 4567', ...extra });
  return { call, book, db, clock, admin: { 'x-admin-key': 'test-admin' }, close: () => { server.closeAllConnections(); server.close(); } };
}
