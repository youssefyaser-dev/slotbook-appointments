'use strict';
const $ = document.getElementById('app');
const S = { step: 0, services: [], providers: [], service: null, provider: null, date: null, time: null, slots: null, booking: null, view: 'book', err: '' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c) => (c / 100).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' EGP';
const mine = () => JSON.parse(localStorage.getItem('sb_tokens') || '[]');
const api = async (method, url, body) => {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Something went wrong'); return d;
};
const ymd = (d) => d.toISOString().slice(0, 10);
const days = () => Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return { iso: new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10), d }; });
const theme = () => { const r = document.documentElement; const dark = (r.dataset.theme || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light')) === 'dark'; r.dataset.theme = dark ? 'light' : 'dark'; localStorage.setItem('sb_theme', r.dataset.theme); };
if (localStorage.getItem('sb_theme')) document.documentElement.dataset.theme = localStorage.getItem('sb_theme');
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.step > 0 && S.view === 'book') go(S.step - 1); });

function frame(inner) {
  $.innerHTML = `<div class="shell"><div class="top"><div class="brand"><i>&#10003;</i>SlotBook</div><div class="icons"><button class="ib" id="mb" aria-label="My bookings">&#9776;</button><button class="ib" id="th" aria-label="Toggle theme">&#9680;</button></div></div>${inner}</div>`;
  document.getElementById('th').onclick = theme;
  document.getElementById('mb').onclick = () => { S.view = S.view === 'mine' ? 'book' : 'mine'; render(); };
}
const bar = () => `<div class="steps">${[0, 1, 2, 3].map((i) => `<b class="${i <= S.step ? 'on' : ''}"></b>`).join('')}</div>`;
const back = () => (S.step > 0 ? '<button class="back" id="bk">&larr; Back</button>' : '');
function go(n) { S.step = n; S.err = ''; render(); }
const bind = () => { const b = document.getElementById('bk'); if (b) b.onclick = () => go(S.step - 1); };

async function render() {
  if (S.view === 'mine') return mineView();
  if (S.booking) return doneView();
  if (!S.services.length) { try { S.services = await api('GET', '/api/services'); } catch (e) { return frame(`<p class="note">${esc(e.message)}</p>`); } }
  if (S.step === 0) {
    frame(`<div class="hero"><h1>Book your visit</h1><p>Pick a service, a specialist and a time. No account needed.</p></div>${bar()}<h2>Choose a service</h2><div class="list">${S.services.map((s) => `<button class="opt" data-id="${s.id}"><span><b>${esc(s.name)}</b><small>${s.minutes} minutes</small></span><span class="price">${money(s.price)}</span></button>`).join('')}</div>`);
    document.querySelectorAll('.opt').forEach((b) => b.onclick = async () => { S.service = S.services.find((s) => s.id == b.dataset.id); S.providers = await api('GET', '/api/providers?service=' + S.service.id); go(1); });
  } else if (S.step === 1) {
    frame(`${back()}${bar()}<h2>Choose a specialist</h2><div class="list">${S.providers.map((p) => `<button class="opt" data-id="${p.id}"><span><b>${esc(p.name)}</b><small>${esc(p.title)}</small></span><span>&rarr;</span></button>`).join('')}</div>`);
    bind(); document.querySelectorAll('.opt').forEach((b) => b.onclick = () => { S.provider = S.providers.find((p) => p.id == b.dataset.id); S.date = null; S.time = null; S.slots = null; go(2); });
  } else if (S.step === 2) {
    const ds = days(); if (!S.date) S.date = ds.find((x) => S.provider.days.includes(x.d.getDay()))?.iso || ds[0].iso;
    frame(`${back()}${bar()}<h2>Pick a day</h2><div class="days">${ds.map((x) => { const open = S.provider.days.includes(x.d.getDay()); return `<button class="day ${x.iso === S.date ? 'sel' : ''}" data-d="${x.iso}" ${open ? '' : 'disabled'}><small>${x.d.toLocaleDateString('en', { weekday: 'short' })}</small><b>${x.d.getDate()}</b><small>${x.d.toLocaleDateString('en', { month: 'short' })}</small></button>`; }).join('')}</div><h2>Available times</h2><div id="sl"><p class="note">Loading...</p></div><button class="btn" id="nx" disabled>Continue</button>`);
    bind();
    document.querySelectorAll('.day').forEach((b) => b.onclick = () => { S.date = b.dataset.d; S.time = null; render(); });
    const a = await api('GET', `/api/availability?provider=${S.provider.id}&service=${S.service.id}&date=${S.date}`);
    const box = document.getElementById('sl'); if (!box) return;
    box.innerHTML = a.slots.length ? `<div class="slots">${a.slots.map((t) => `<button class="slot ${t === S.time ? 'sel' : ''}">${t}</button>`).join('')}</div>` : `<p class="note">${{ full: 'Fully booked that day.', closed: 'Closed that day.', time_off: 'Not available that day.', past: 'That day has passed.' }[a.reason] || 'No times available.'}</p>`;
    const nx = document.getElementById('nx'); nx.disabled = !S.time; nx.onclick = () => go(3);
    box.querySelectorAll('.slot').forEach((b) => b.onclick = () => { S.time = b.textContent; box.querySelectorAll('.slot').forEach((x) => x.classList.toggle('sel', x === b)); nx.disabled = false; });
  } else {
    frame(`${back()}${bar()}<div class="card"><div class="row"><span>Service</span><b>${esc(S.service.name)}</b></div><div class="row"><span>With</span><b>${esc(S.provider.name)}</b></div><div class="row"><span>When</span><b>${new Date(S.date + 'T00:00').toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' })}, ${S.time}</b></div><div class="row"><span>Price</span><b>${money(S.service.price)}</b></div></div>
    <form id="f"><label>Full name</label><input name="name" required minlength="2" autocomplete="name"><label>Phone</label><input name="phone" type="tel" required autocomplete="tel" placeholder="+20 100 000 0000"><label>Notes (optional)</label><textarea name="notes" rows="2" maxlength="300"></textarea><div class="err">${esc(S.err)}</div><button class="btn">Confirm booking</button></form>`);
    bind();
    document.getElementById('f').onsubmit = async (e) => {
      e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
      try {
        S.booking = await api('POST', '/api/bookings', { ...f, provider_id: S.provider.id, service_id: S.service.id, date: S.date, time: S.time });
        localStorage.setItem('sb_tokens', JSON.stringify([S.booking.token, ...mine()].slice(0, 20))); render();
      } catch (x) { S.err = x.message; if (/not available/.test(x.message)) { S.time = null; return go(2); } render(); }
    };
  }
}
function bookingCard(b) {
  return `<div class="card" style="margin-bottom:12px"><div class="row"><span>Status</span><span class="badge ${esc(b.status)}">${esc(b.status)}</span></div><div class="row"><span>Service</span><b>${esc(b.service.name)}</b></div><div class="row"><span>With</span><b>${esc(b.provider.name)}</b></div><div class="row"><span>When</span><b>${new Date(b.date + 'T00:00').toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' })}, ${esc(b.start)}</b></div><div class="row"><span>Reference</span><b style="font-family:ui-monospace,monospace">${esc(b.token)}</b></div></div>`;
}
function doneView() {
  frame(`<div style="text-align:center;margin:10px 0 18px"><div class="ok">&#10003;</div><h1 style="margin:0">You are booked</h1><p class="note" style="padding:6px 0">Keep your reference to view or cancel it later.</p></div>${bookingCard(S.booking)}<button class="btn" id="again">Book another</button>`);
  document.getElementById('again').onclick = () => { Object.assign(S, { step: 0, service: null, provider: null, date: null, time: null, booking: null }); render(); };
}
async function mineView() {
  frame('<h2>My bookings</h2><div id="ml"><p class="note">Loading...</p></div><button class="btn ghost" id="bb">Back to booking</button>');
  document.getElementById('bb').onclick = () => { S.view = 'book'; render(); };
  const out = []; for (const t of mine()) { try { out.push(await api('GET', '/api/bookings/' + t)); } catch { /* removed */ } }
  const box = document.getElementById('ml'); if (!box) return;
  box.innerHTML = out.length ? out.map((b) => bookingCard(b) + (b.status === 'booked' ? `<button class="btn ghost" style="margin:-4px 0 14px" data-t="${esc(b.token)}">Cancel this booking</button>` : '')).join('') : '<p class="note">No bookings on this device yet.</p>';
  box.querySelectorAll('[data-t]').forEach((b) => b.onclick = async () => { try { await api('DELETE', '/api/bookings/' + b.dataset.t); mineView(); } catch (e) { alert(e.message); } });
}
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('/sw.js').catch(() => {});
render();
