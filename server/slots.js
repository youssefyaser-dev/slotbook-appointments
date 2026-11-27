// Pure scheduling helpers. Times are minutes since midnight; dates are YYYY-MM-DD strings.
export const toMin = (hhmm) => { const m = /^(\d{2}):(\d{2})$/.exec(hhmm); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
export const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export function isDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export const weekday = (s) => new Date(s + 'T00:00:00Z').getUTCDay(); // 0 = Sunday
export const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Free start times for one provider on one day.
 * busy: [{start_min, end_min}] existing bookings. step: grid in minutes. nowMin: earliest allowed start today (null for other days). */
export function freeSlots({ workStart, workEnd, minutes, busy, step = 15, nowMin = null }) {
  const out = [];
  for (let t = workStart; t + minutes <= workEnd; t += step) {
    if (nowMin !== null && t < nowMin) continue;
    if (busy.some((b) => t < b.end_min && t + minutes > b.start_min)) continue;
    out.push(t);
  }
  return out;
}
