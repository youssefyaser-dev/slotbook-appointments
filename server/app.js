import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toMin, toHHMM, isDate, weekday, addDays, freeSlots } from './slots.js';

const PUBLIC = fileURLToPath(new URL('../public', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m) => new HttpError(400, m);

/** createApp(db, { adminKey, now, maxDaysAhead }) -> node http.Server. `now()` returns {date, minutes} so tests can pin the clock. */
export function createApp(db, opts = {}) {
  const adminKey = opts.adminKey || 'dev-admin-key';
  const now = opts.now || (() => { const d = new Date(); return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() }; });
  const maxAhead = opts.maxDaysAhead ?? 60;
  const q = (sql, ...a) => db.prepare(sql).all(...a);
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const hits = new Map(); // naive per-IP rate limit for booking writes

  function limited(ip) {
    const t = Date.now(), list = (hits.get(ip) || []).filter((x) => t - x < 60000);
    list.push(t); hits.set(ip, list);
    return list.length > (opts.rateLimit ?? 30);
  }

  function providerOut(p) {
    return { id: p.id, name: p.name, title: p.title, work_start: p.work_start, work_end: p.work_end, days: p.days.split(',').map(Number),
      services: q('SELECT service_id FROM provider_services WHERE provider_id = ?', p.id).map((r) => r.service_id) };
  }
  const bookingOut = (b) => b && ({ token: b.token, id: b.id, status: b.status, date: b.date, start: toHHMM(b.start_min), end: toHHMM(b.end_min), name: b.name, phone: b.phone, notes: b.notes,
    provider: one('SELECT id, name, title FROM providers WHERE id = ?', b.provider_id), service: one('SELECT id, name, minutes, price FROM services WHERE id = ?', b.service_id) });

  function availability(providerId, serviceId, date) {
    if (!isDate(date)) throw bad('date must be YYYY-MM-DD');
    const n = now();
    if (date < n.date) return { date, slots: [], reason: 'past' };
    if (date > addDays(n.date, maxAhead)) return { date, slots: [], reason: 'too_far' };
    const p = one('SELECT * FROM providers WHERE id = ? AND active = 1', providerId);
    const s = one('SELECT * FROM services WHERE id = ? AND active = 1', serviceId);
    if (!p || !s) throw new HttpError(404, 'provider or service not found');
    if (!one('SELECT 1 FROM provider_services WHERE provider_id = ? AND service_id = ?', p.id, s.id)) throw bad('this provider does not offer that service');
    if (!p.days.split(',').map(Number).includes(weekday(date))) return { date, slots: [], reason: 'closed' };
    if (one('SELECT 1 FROM time_off WHERE provider_id = ? AND date = ?', p.id, date)) return { date, slots: [], reason: 'time_off' };
    const busy = q("SELECT start_min, end_min FROM bookings WHERE provider_id = ? AND date = ? AND status IN ('booked','completed','no_show')", p.id, date);
    const slots = freeSlots({ workStart: toMin(p.work_start), workEnd: toMin(p.work_end), minutes: s.minutes, busy, nowMin: date === n.date ? n.minutes + 30 : null });
    return { date, slots: slots.map(toHHMM), reason: slots.length ? null : 'full' };
  }

  function createBooking(b) {
    const name = String(b.name ?? '').trim(), phone = String(b.phone ?? '').trim(), notes = String(b.notes ?? '').trim();
    if (name.length < 2 || name.length > 80) throw bad('name must be 2 to 80 characters');
    if (!/^\+?[0-9 ()-]{7,20}$/.test(phone)) throw bad('phone number looks invalid');
    if (notes.length > 300) throw bad('notes are limited to 300 characters');
    const time = toMin(String(b.time ?? ''));
    if (Number.isNaN(time)) throw bad('time must be HH:MM');
    const a = availability(Number(b.provider_id), Number(b.service_id), String(b.date ?? ''));
    if (!a.slots.includes(toHHMM(time))) throw new HttpError(409, 'that time is not available');
    const s = one('SELECT minutes FROM services WHERE id = ?', Number(b.service_id));
    const token = crypto.randomBytes(9).toString('base64url');
    // The conflict check and insert run in one transaction so two requests cannot take the same slot.
    db.exec('BEGIN IMMEDIATE');
    try {
      const clash = one("SELECT 1 FROM bookings WHERE provider_id = ? AND date = ? AND status IN ('booked','completed','no_show') AND ? < end_min AND ? > start_min", Number(b.provider_id), b.date, time, time + s.minutes);
      if (clash) throw new HttpError(409, 'that time is not available');
      run('INSERT INTO bookings (token, provider_id, service_id, name, phone, notes, date, start_min, end_min, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', token, Number(b.provider_id), Number(b.service_id), name, phone, notes, b.date, time, time + s.minutes, new Date().toISOString());
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return bookingOut(one('SELECT * FROM bookings WHERE token = ?', token));
  }

  const isAdmin = (req) => { const k = String(req.headers['x-admin-key'] || ''); return k.length === adminKey.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(adminKey)); };

  async function route(req, url, body) {
    const m = req.method, p = url.pathname, sp = url.searchParams;
    if (m === 'GET' && p === '/api/health') return [200, { ok: true }];
    if (m === 'GET' && p === '/api/services') return [200, q('SELECT id, name, minutes, price FROM services WHERE active = 1 ORDER BY name')];
    if (m === 'GET' && p === '/api/providers') {
      const sid = sp.get('service');
      return [200, q('SELECT * FROM providers WHERE active = 1 ORDER BY name').map(providerOut).filter((x) => !sid || x.services.includes(Number(sid)))];
    }
    if (m === 'GET' && p === '/api/availability') return [200, availability(Number(sp.get('provider')), Number(sp.get('service')), sp.get('date') || '')];
    if (m === 'POST' && p === '/api/bookings') {
      if (limited(req.socket.remoteAddress)) throw new HttpError(429, 'too many requests, slow down');
      return [201, createBooking(body)];
    }
    let mm;
    if ((mm = /^\/api\/bookings\/([\w-]{6,})$/.exec(p))) {
      const b = one('SELECT * FROM bookings WHERE token = ?', mm[1]);
      if (!b) throw new HttpError(404, 'booking not found');
      if (m === 'GET') return [200, bookingOut(b)];
      if (m === 'DELETE') {
        if (b.status !== 'booked') throw new HttpError(409, `a ${b.status} booking cannot be cancelled`);
        const n = now();
        if (b.date < n.date || (b.date === n.date && b.start_min - n.minutes < 120)) throw new HttpError(409, 'bookings can only be cancelled up to 2 hours before the start');
        run("UPDATE bookings SET status = 'cancelled' WHERE id = ?", b.id);
        return [200, bookingOut(one('SELECT * FROM bookings WHERE id = ?', b.id))];
      }
    }
    if (p.startsWith('/api/admin/')) {
      if (!isAdmin(req)) throw new HttpError(401, 'admin key required');
      if (m === 'GET' && p === '/api/admin/bookings') {
        const date = sp.get('date');
        if (date && !isDate(date)) throw bad('date must be YYYY-MM-DD');
        const rows = date ? q('SELECT * FROM bookings WHERE date = ? ORDER BY start_min', date) : q('SELECT * FROM bookings ORDER BY date, start_min LIMIT 500');
        return [200, rows.map(bookingOut)];
      }
      if (m === 'PATCH' && (mm = /^\/api\/admin\/bookings\/(\d+)$/.exec(p))) {
        const status = body.status;
        if (!['completed', 'cancelled', 'no_show'].includes(status)) throw bad('status must be completed, cancelled or no_show');
        const b = one('SELECT * FROM bookings WHERE id = ?', Number(mm[1]));
        if (!b) throw new HttpError(404, 'booking not found');
        if (b.status !== 'booked') throw new HttpError(409, `booking is already ${b.status}`);
        run('UPDATE bookings SET status = ? WHERE id = ?', status, b.id);
        return [200, bookingOut(one('SELECT * FROM bookings WHERE id = ?', b.id))];
      }
      if (m === 'POST' && p === '/api/admin/time-off') {
        if (!isDate(String(body.date)) || !one('SELECT 1 FROM providers WHERE id = ?', Number(body.provider_id))) throw bad('provider_id and date are required');
        const clash = one("SELECT COUNT(*) n FROM bookings WHERE provider_id = ? AND date = ? AND status = 'booked'", Number(body.provider_id), body.date);
        if (clash.n) throw new HttpError(409, `${clash.n} booking(s) exist on that day; cancel them first`);
        run('INSERT INTO time_off (provider_id, date, note) VALUES (?,?,?)', Number(body.provider_id), body.date, String(body.note || '').slice(0, 100));
        return [201, { ok: true }];
      }
      if (m === 'GET' && p === '/api/admin/stats') {
        const r = q('SELECT status, COUNT(*) n FROM bookings GROUP BY status');
        return [200, Object.fromEntries(r.map((x) => [x.status, x.n]))];
      }
    }
    if (p.startsWith('/api/')) throw new HttpError(404, 'not found');
    return null;
  }

  function serveStatic(res, pathname) {
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = path.resolve(PUBLIC, rel);
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': rel === 'sw.js' ? 'no-cache' : 'public, max-age=300' });
    fs.createReadStream(file).pipe(res);
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (status, data) => { res.writeHead(status, { 'content-type': 'application/json', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(data)); };
    try {
      let body = {};
      if (['POST', 'PATCH', 'PUT'].includes(req.method)) {
        const chunks = []; let size = 0;
        for await (const c of req) { size += c.length; if (size > 20000) throw new HttpError(413, 'request too large'); chunks.push(c); }
        try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}; } catch { throw bad('invalid JSON'); }
        if (body === null || typeof body !== 'object' || Array.isArray(body)) throw bad('JSON object expected');
      }
      const r = await route(req, url, body);
      if (r) return send(r[0], r[1]);
      if (req.method !== 'GET') return send(405, { error: 'method not allowed' });
      serveStatic(res, url.pathname);
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.message });
      console.error(e); send(500, { error: 'internal error' });
    }
  });
}
