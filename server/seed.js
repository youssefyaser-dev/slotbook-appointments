export function seedDemo(db) {
  if (db.prepare('SELECT 1 FROM services').get()) return;
  const svc = [['Initial consultation', 45, 90000], ['Follow-up visit', 20, 45000], ['Skin check', 30, 60000], ['Dental cleaning', 40, 70000], ['Physiotherapy session', 50, 80000]];
  svc.forEach(([n, m, p]) => db.prepare('INSERT INTO services (name, minutes, price) VALUES (?,?,?)').run(n, m, p));
  const pr = [['Dr. Nadia Hassan', 'General practitioner', '09:00', '17:00', '0,1,2,3,4', [1, 2]], ['Dr. Omar Khaled', 'Dermatologist', '10:00', '16:00', '1,2,3,4', [1, 2, 3]],
    ['Dr. Salma Adel', 'Dentist', '09:00', '15:00', '0,2,3,4,6', [1, 4]], ['Karim Fathy', 'Physiotherapist', '11:00', '19:00', '0,1,2,3,4', [5]]];
  pr.forEach(([n, t, s, e, d, ids], i) => {
    db.prepare('INSERT INTO providers (name, title, work_start, work_end, days) VALUES (?,?,?,?,?)').run(n, t, s, e, d);
    ids.forEach((sid) => db.prepare('INSERT INTO provider_services VALUES (?,?)').run(i + 1, sid));
  });
}
