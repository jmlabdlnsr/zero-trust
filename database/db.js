import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  return db;
}
export function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function createIdentityRepository(db) {
  return {
    findUser(id) {
      return db.prepare('SELECT id,username,name,role,nim,active FROM users WHERE id=?').get(id);
    },
    hasActiveDevice(userId, deviceId) {
      return Boolean(db.prepare('SELECT 1 FROM devices WHERE user_id=? AND device_id=? AND active=1').get(userId, deviceId));
    },
    findSession(id) {
      return db.prepare('SELECT * FROM sessions WHERE id=?').get(id);
    },
  };
}
