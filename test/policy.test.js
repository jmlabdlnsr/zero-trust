import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../config.js';
import { openDatabase } from '../database/db.js';
import { seedDatabase } from '../database/seed.js';
import { decideAccess } from '../gateway/policy.js';
import { isWithinAccessHours } from '../shared/index.js';

const config = loadConfig({ JWT_SECRET: 'j'.repeat(64), GATEWAY_SECRET: 'g'.repeat(64),
  SERVICE_CLIENT_SECRET: 's'.repeat(64) });
const now = new Date('2026-10-28T03:00:00Z'); // 10.00 WIB
const seedEnv = {
  SEED_ADMIN_PASSWORD: 'AdminDemoPass12!',
  SEED_DOSEN01_PASSWORD: 'DosenSatuPass12!',
  SEED_DOSEN02_PASSWORD: 'DosenDuaPass12!',
  SEED_MHS01_PASSWORD: 'MhsSatuDemoPass12!',
  SEED_MHS02_PASSWORD: 'MhsDuaDemoPass12!',
  SEED_MHS03_PASSWORD: 'MhsTigaDemoPass12!',
};

test('jam akses memakai Asia/Jakarta, termasuk awal tetapi tidak termasuk akhir', () => {
  for (const [time, expected] of [['23:59:00', false], ['00:00:00', true],
    ['13:59:59', true], ['14:00:00', false]]) {
    assert.equal(isWithinAccessHours(new Date(`2026-10-28T${time}Z`), config), expected);
  }
  assert.equal(isWithinAccessHours(now, { ...config, accessStart: '21:00', accessEnd: '07:00' }), false);
  assert.equal(isWithinAccessHours(new Date('2026-10-28T16:00:00Z'),
    { ...config, accessStart: '21:00', accessEnd: '07:00' }), true);
  assert.equal(isWithinAccessHours(now, { ...config, accessStart: '00:00', accessEnd: '24:00' }), true);
});

test('konfigurasi menolak secret pendek, port bentrok, dan jam tidak valid', () => {
  const env = { JWT_SECRET: 'j'.repeat(64), GATEWAY_SECRET: 'g'.repeat(64), SERVICE_CLIENT_SECRET: 's'.repeat(64) };
  assert.throws(() => loadConfig({ ...env, JWT_SECRET: 'pendek' }));
  assert.throws(() => loadConfig({ ...env, ACCESS_START: '25:00' }));
  assert.throws(() => loadConfig({ ...env, NILAI_PORT: '3000' }));
});

test('policy mengecek role, kepemilikan, device, sesi dan data terbaru dari DB', () => {
  const db = openDatabase(':memory:');
  try {
    assert.throws(() => seedDatabase(db, {}), /SEED_ADMIN_PASSWORD wajib diisi/);
    assert.throws(() => seedDatabase(db, { ...seedEnv, SEED_ADMIN_PASSWORD: 'short' }),
      /SEED_ADMIN_PASSWORD wajib diisi/);
    seedDatabase(db, seedEnv);
    seedDatabase(db, {}); // seed yang sudah ada tidak diubah atau divalidasi ulang
    assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 6);
    for (const id of ['admin', 'dosen1', 'dosen2', 'mhs1', 'mhs2', 'mhs3']) {
      db.prepare('INSERT INTO sessions (id,user_id,device_id,refresh_hash,expires_at) VALUES (?,?,?,?,?)')
        .run(`s-${id}`, id, `${id}-laptop`, `hash-${id}`, Math.floor(now.getTime() / 1000) + 86400);
    }
    function check(id, method, path, extra = {}) {
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      return decideAccess({ db, config, method, path, deviceId: `${id}-laptop`, now,
        claims: { sub: id, role: user.role, type: 'access', sid: `s-${id}`, device: `${id}-laptop` }, ...extra });
    }
    for (const [id, method, path, allowed] of [
      ['mhs1', 'GET', '/nilai', true], ['dosen1', 'GET', '/nilai', true], ['admin', 'GET', '/nilai', false],
      ['mhs1', 'GET', '/transkrip/237006001', true], ['mhs1', 'GET', '/transkrip/237006002', false],
      ['admin', 'GET', '/transkrip/237006002', true], ['dosen1', 'GET', '/transkrip/237006001', false],
      ['dosen1', 'PUT', '/nilai/1', true], ['dosen2', 'PUT', '/nilai/1', false], ['mhs1', 'PUT', '/nilai/1', false],
      ['dosen1', 'POST', '/kelas/1/finalisasi', true], ['dosen2', 'POST', '/kelas/1/finalisasi', false],
      ['admin', 'POST', '/transkrip/sinkron', false], ['dosen1', 'POST', '/transkrip/sinkron', false],
      ['mhs1', 'DELETE', '/nilai/1', false], ['mhs1', 'GET', '/rahasia', false]
    ]) assert.equal(check(id, method, path).allowed, allowed, `${id} ${method} ${path}`);
    assert.equal(check('mhs1', 'GET', '/nilai', { deviceId: 'device-asing' }).allowed, false);
    assert.equal(check('dosen1', 'PUT', '/nilai/1', { now: new Date('2026-10-28T15:00:00Z') }).allowed, false);
    db.prepare("UPDATE classes SET finalized_at='2026-10-28T03:00:00Z' WHERE id=1").run();
    assert.equal(check('dosen1', 'PUT', '/nilai/1').allowed, false);
    db.prepare("UPDATE sessions SET revoked_at=1 WHERE user_id='mhs1'").run();
    assert.equal(check('mhs1', 'GET', '/nilai').allowed, false);
    db.prepare("UPDATE devices SET active=0 WHERE user_id='mhs2'").run();
    assert.equal(check('mhs2', 'GET', '/nilai').allowed, false);
    assert.equal(check('mhs3', 'GET', '/nilai', { claims: { sub: 'mhs3', role: 'admin', type: 'access', sid: 's-mhs3', device: 'mhs3-laptop' } }).allowed, false);
    const service = { sub: config.serviceClientId, role: 'service', type: 'service' };
    assert.equal(decideAccess({ db, config, claims: service, method: 'POST', path: '/transkrip/sinkron', now }).allowed, true);
    assert.equal(decideAccess({ db, config, claims: service, method: 'GET', path: '/nilai', now }).allowed, false);
    assert.equal(decideAccess({ db, config, claims: { ...service, sub: 'other-service' }, method: 'POST', path: '/transkrip/sinkron', now }).allowed, false);
  } finally { db.close(); }
});
