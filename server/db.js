import { DatabaseSync } from 'node:sqlite';

export function openDb(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS services (id INTEGER PRIMARY KEY, name TEXT NOT NULL, minutes INTEGER NOT NULL CHECK (minutes BETWEEN 5 AND 480), price INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS providers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
    work_start TEXT NOT NULL DEFAULT '09:00', work_end TEXT NOT NULL DEFAULT '17:00', days TEXT NOT NULL DEFAULT '1,2,3,4,5', active INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS provider_services (provider_id INTEGER NOT NULL REFERENCES providers(id), service_id INTEGER NOT NULL REFERENCES services(id), PRIMARY KEY (provider_id, service_id));
  CREATE TABLE IF NOT EXISTS time_off (id INTEGER PRIMARY KEY, provider_id INTEGER NOT NULL REFERENCES providers(id), date TEXT NOT NULL, note TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS bookings (id INTEGER PRIMARY KEY, token TEXT NOT NULL UNIQUE, provider_id INTEGER NOT NULL REFERENCES providers(id), service_id INTEGER NOT NULL REFERENCES services(id),
    name TEXT NOT NULL, phone TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', date TEXT NOT NULL, start_min INTEGER NOT NULL, end_min INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','completed','cancelled','no_show')), created_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS bookings_day ON bookings (provider_id, date);
  `);
  return db;
}
