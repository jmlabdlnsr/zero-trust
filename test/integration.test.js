import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import { loadConfig } from '../config.js';
import { openDatabase } from '../database/db.js';
import { getSeedPasswords, seedDatabase } from '../database/seed.js';
import { createGateway } from '../gateway/index.js';
import { createNilai } from '../service-nilai/index.js';
import { createTranskrip } from '../service-transkrip/index.js';

async function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}
const stop = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
const seedEnv = {
  SEED_ADMIN_PASSWORD: 'AdminDemoPass12!',
  SEED_DOSEN01_PASSWORD: 'DosenSatuPass12!',
  SEED_DOSEN02_PASSWORD: 'DosenDuaPass12!',
  SEED_MHS01_PASSWORD: 'MhsSatuDemoPass12!',
  SEED_MHS02_PASSWORD: 'MhsDuaDemoPass12!',
  SEED_MHS03_PASSWORD: 'MhsTigaDemoPass12!',
};
const seedPasswords = getSeedPasswords(seedEnv);

test('alur HTTP Zero Trust dengan gateway dan dua service nyata', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'zero-trust-test-'));
  const config = loadConfig({ JWT_SECRET: 'j'.repeat(64), GATEWAY_SECRET: 'g'.repeat(64),
    SERVICE_CLIENT_SECRET: 's'.repeat(64), DB_PATH: join(folder, 'test.sqlite'), REQUEST_TIMEOUT_MS: '1000' });
  let clock = new Date('2026-10-28T03:00:00Z');
  const now = () => clock;
  const databases = [openDatabase(config.dbPath), openDatabase(config.dbPath), openDatabase(config.dbPath)];
  const db = databases[0]; seedDatabase(db, seedEnv);
  const transkrip = await listen(createTranskrip({ db: databases[2], config, now }));
  config.transkripUrl = `http://127.0.0.1:${transkrip.address().port}`;
  const nilai = await listen(createNilai({ db: databases[1], config, now }));
  config.nilaiUrl = `http://127.0.0.1:${nilai.address().port}`;
  const gateway = await listen(createGateway({ db, config, now }));
  config.gatewayUrl = `http://127.0.0.1:${gateway.address().port}`;
  t.after(async () => {
    await Promise.all([stop(gateway), stop(nilai), stop(transkrip)]);
    databases.forEach(conn => conn.close());
    rmSync(folder, { recursive: true, force: true }); // generated OS temp folder only
  });

  async function call(path, { method = 'GET', body, token, device, base = config.gatewayUrl, headers = {}, raw } = {}) {
    const response = await fetch(base + path, { method, headers: {
      ...(body !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(device ? { 'X-Device-ID': device } : {}), ...headers,
    }, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    const data = await response.json();
    return { status: response.status, data };
  }
  async function login(username, device = `${username}-laptop`) {
    return call('/auth/login', { method: 'POST', device, body: { username, password: seedPasswords[username] } });
  }
  const sessions = {};

  await t.test('login menolak password salah dan device asing; menerbitkan JWT 600 detik dan refresh 1 hari', async () => {
    assert.equal((await call('/auth/login', { method: 'POST', device: 'mhs1-laptop', body: { username: 'mhs1', password: 'salah' } })).status, 401);
    assert.equal((await login('mhs1', 'asing')).status, 403);
    for (const user of ['admin', 'dosen1', 'dosen2', 'mhs1', 'mhs2', 'mhs3']) {
      const result = await login(user); assert.equal(result.status, 200);
      sessions[user] = { token: result.data.access_token, device: `${user}-laptop`, refresh: result.data.refresh_token };
      const claims = jwt.decode(result.data.access_token);
      assert.equal(claims.sub, user); assert.equal(claims.exp - claims.iat, 600);
      assert.equal(result.data.refresh_expires_in, 86400);
      const stored = db.prepare('SELECT * FROM sessions WHERE id=?').get(claims.sid);
      assert.notEqual(stored.refresh_hash, result.data.refresh_token);
      assert.equal(stored.expires_at - claims.iat, 86400);
    }
  });
  const as = (user, opts = {}) => ({ ...sessions[user], ...opts });

  await t.test('token hilang, rusak, kedaluwarsa, algoritma salah dan device hilang/asing ditolak', async () => {
    assert.equal((await call('/nilai')).status, 401);
    assert.equal((await call('/nilai', as('mhs1', { token: 'invalid' }))).status, 401);
    assert.equal((await call('/nilai', as('mhs1', { device: undefined }))).status, 403);
    assert.equal((await call('/nilai', as('mhs1', { device: 'mhs2-laptop' }))).status, 403);
    const claims = jwt.decode(sessions.mhs1.token);
    for (const [payload, algorithm, key] of [
      [{ ...claims, exp: claims.iat - 1 }, 'HS256', config.jwtSecret],
      [claims, 'HS384', config.jwtSecret], [claims, 'HS256', 'wrong-secret'],
      [{ sub: 'mhs1', role: 'mahasiswa' }, 'HS256', config.jwtSecret],
    ]) {
      assert.equal((await call('/nilai', as('mhs1', { token: jwt.sign(payload, key, { algorithm }) }))).status, 401);
    }
  });

  await t.test('mahasiswa hanya nilai sendiri; dosen hanya kelas sendiri; admin tidak boleh GET nilai', async () => {
    const student = await call('/nilai?nim=237006002', as('mhs1'));
    assert.equal(student.status, 200); assert.equal(student.data.data.length, 2);
    assert.deepEqual(student.data.data.map(x => x.nim), ['237006001', '237006001']);
    const lecturer = await call('/nilai', as('dosen1'));
    assert.equal(lecturer.data.data.length, 3);
    assert.ok(lecturer.data.data.every(x => x.kelas_id === 1));
    assert.equal((await call('/nilai', as('admin'))).status, 403);
    assert.equal((await call('/transkrip/237006002', as('mhs1'))).status, 403);
    assert.equal((await call('/transkrip/237006001', as('dosen1'))).status, 403);
    assert.equal((await call('/transkrip/237006001', as('admin'))).status, 200);
    assert.equal((await call('/transkrip/000000000', as('admin'))).status, 404);
  });

  await t.test('service menolak bypass, termasuk gateway secret benar tetapi JWT tidak valid', async () => {
    for (const [base, path] of [[config.nilaiUrl, '/nilai'], [config.transkripUrl, '/transkrip/237006001']]) {
      assert.equal((await call(path, as('mhs1', { base }))).status, 403);
      assert.equal((await call(path, { base, headers: { 'X-Gateway-Secret': config.gatewaySecret } })).status, 401);
      const expired = jwt.sign({ ...jwt.decode(sessions.mhs1.token), exp: 1 }, config.jwtSecret);
      assert.equal((await call(path, as('mhs1', { base, token: expired, headers: { 'X-Gateway-Secret': config.gatewaySecret } }))).status, 401);
    }
    const denied = await call('/nilai/1', as('dosen2', { method: 'PUT', body: { nilai: 99 }, base: config.nilaiUrl,
      headers: { 'X-Gateway-Secret': config.gatewaySecret } }));
    assert.equal(denied.status, 403);
    const direct = { headers: { 'X-Gateway-Secret': config.gatewaySecret } };
    assert.equal((await call('/nilai', as('admin', { ...direct, base: config.nilaiUrl }))).status, 403);
    assert.equal((await call('/nilai', as('mhs1', { ...direct, base: config.nilaiUrl, device: undefined }))).status, 403);
    assert.equal((await call('/kelas/1/finalisasi', as('dosen2', { ...direct, base: config.nilaiUrl, method: 'POST' }))).status, 403);
    assert.equal((await call('/transkrip/237006002', as('mhs1', { ...direct, base: config.transkripUrl }))).status, 403);
    assert.equal((await call('/transkrip/sinkron', as('admin', { ...direct, base: config.transkripUrl, method: 'POST', body: { kelas_id: 1 } }))).status, 403);
  });

  await t.test('edit mengecek dosen pengampu, rentang nilai dan body ketat', async () => {
    assert.equal((await call('/nilai/1', as('mhs1', { method: 'PUT', body: { nilai: 99 } }))).status, 403);
    assert.equal((await call('/nilai/1', as('dosen2', { method: 'PUT', body: { nilai: 99 } }))).status, 403);
    for (const body of [{ nilai: -1 }, { nilai: 101 }, { nilai: '90' }, {}, { nilai: 90, final: true }]) {
      assert.equal((await call('/nilai/1', as('dosen1', { method: 'PUT', body }))).status, 400);
    }
    assert.equal((await call('/nilai/1', as('dosen1', { method: 'PUT', body: { nilai: 92.5 } }))).status, 200);
    assert.equal(db.prepare('SELECT score FROM grades WHERE id=1').get().score, 92.5);
  });

  await t.test('jam akses menolak edit/finalisasi namun tetap mengizinkan baca', async () => {
    clock = new Date('2026-10-28T15:00:00Z'); // login ulang agar token bukan expired
    const late = await login('dosen1');
    const opts = { token: late.data.access_token, device: 'dosen1-laptop' };
    assert.equal((await call('/nilai/1', { ...opts, method: 'PUT', body: { nilai: 80 } })).status, 403);
    assert.equal((await call('/kelas/1/finalisasi', { ...opts, method: 'POST' })).status, 403);
    assert.equal((await call('/nilai', opts)).status, 200);
    clock = new Date('2026-10-28T03:00:00Z');
  });

  await t.test('token service 300 detik dan scope eksklusif; payload sinkron tidak boleh menyisipkan nilai', async () => {
    assert.equal((await call('/auth/service', { method: 'POST', body: { client_id: config.serviceClientId, client_secret: 'wrong' } })).status, 401);
    for (const user of ['admin', 'dosen1', 'mhs1']) assert.equal((await call('/transkrip/sinkron', as(user, { method: 'POST', body: { kelas_id: 1 } }))).status, 403);
    const service = await call('/auth/service', { method: 'POST', body: { client_id: config.serviceClientId, client_secret: config.serviceClientSecret } });
    const claims = jwt.decode(service.data.access_token); assert.equal(claims.exp - claims.iat, 300);
    const opts = { token: service.data.access_token };
    assert.equal((await call('/nilai', opts)).status, 403);
    assert.equal((await call('/nilai', { ...opts, base: config.nilaiUrl, headers: { 'X-Gateway-Secret': config.gatewaySecret } })).status, 403);
    assert.equal((await call('/transkrip/237006001', { ...opts, base: config.transkripUrl, headers: { 'X-Gateway-Secret': config.gatewaySecret } })).status, 403);
    assert.equal((await call('/transkrip/sinkron', { ...opts, method: 'POST', body: { kelas_id: 1 } })).status, 409);
    assert.equal((await call('/transkrip/sinkron', { ...opts, method: 'POST', body: { kelas_id: 1, nilai: 100 } })).status, 400);
  });

  await t.test('body non-JSON tidak boleh diam-diam memfinalisasi kelas', async () => {
    const result = await call('/kelas/1/finalisasi', as('dosen1', { method: 'POST', raw: 'nilai=100',
      headers: { 'Content-Type': 'text/plain' } }));
    assert.equal(result.status, 415);
    assert.equal(db.prepare('SELECT finalized_at FROM classes WHERE id=1').get().finalized_at, null);
  });

  await t.test('finalisasi melewati gateway ke transkrip, mengunci nilai dan idempoten', async () => {
    assert.equal((await call('/kelas/1/finalisasi', as('dosen2', { method: 'POST' }))).status, 403);
    const result = await call('/kelas/1/finalisasi', as('dosen1', { method: 'POST' }));
    assert.equal(result.status, 200); assert.equal(result.data.sync_status, 'synced');
    assert.equal((await call('/nilai/1', as('dosen1', { method: 'PUT', body: { nilai: 10 } }))).status, 409);
    const transcript = await call('/transkrip/237006001', as('mhs1'));
    assert.equal(transcript.data.data.length, 1); assert.equal(transcript.data.data[0].nilai, 92.5);
    assert.equal((await call('/kelas/1/finalisasi', as('dosen1', { method: 'POST' }))).status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM transcripts WHERE class_id=1').get().n, 3);
    const log = db.prepare("SELECT * FROM audit_logs WHERE subject='service-nilai' AND endpoint='/transkrip/sinkron' AND decision='allow'").all();
    assert.ok(log.length >= 1);
  });

  await t.test('nilai belum lengkap tidak difinalisasi; gagal sinkron bisa retry tanpa membuka kunci', async () => {
    db.prepare('UPDATE grades SET score=NULL WHERE id=4').run();
    assert.equal((await call('/kelas/2/finalisasi', as('dosen2', { method: 'POST' }))).status, 409);
    assert.equal(db.prepare('SELECT finalized_at FROM classes WHERE id=2').get().finalized_at, null);
    db.prepare('UPDATE grades SET score=70 WHERE id=4').run();
    const originalUrl = config.transkripUrl; config.transkripUrl = 'http://127.0.0.1:1';
    const failed = await call('/kelas/2/finalisasi', as('dosen2', { method: 'POST' }));
    config.transkripUrl = originalUrl;
    assert.equal(failed.status, 502); assert.equal(failed.data.error.code, 'TRANSCRIPT_SYNC_PENDING');
    assert.equal(db.prepare('SELECT sync_status FROM classes WHERE id=2').get().sync_status, 'pending');
    assert.equal((await call('/nilai/4', as('dosen2', { method: 'PUT', body: { nilai: 1 } }))).status, 409);
    assert.equal((await call('/kelas/2/finalisasi', as('dosen2', { method: 'POST' }))).status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM transcripts').get().n, 6);
  });

  await t.test('edit dan finalisasi bersamaan tidak menghasilkan transkrip berbeda atau duplikat', async () => {
    db.prepare('INSERT INTO classes (id,code,name,credits,lecturer_id) VALUES (3,?,?,3,?)').run('TEST-RACE', 'Concurrency', 'dosen1');
    db.prepare('INSERT INTO grades (id,class_id,student_id,score) VALUES (7,3,?,60)').run('mhs1');
    const [edit, finalA, finalB] = await Promise.all([
      call('/nilai/7', as('dosen1', { method: 'PUT', body: { nilai: 93 } })),
      call('/kelas/3/finalisasi', as('dosen1', { method: 'POST' })),
      call('/kelas/3/finalisasi', as('dosen1', { method: 'POST' })),
    ]);
    assert.ok([200, 409].includes(edit.status));
    assert.equal(finalA.status, 200); assert.equal(finalB.status, 200);
    const grade = db.prepare('SELECT score FROM grades WHERE id=7').get();
    const transcripts = db.prepare('SELECT score FROM transcripts WHERE grade_id=7').all();
    assert.equal(transcripts.length, 1);
    assert.equal(grade.score, edit.status === 200 ? 93 : 60);
    assert.equal(transcripts[0].score, grade.score);
    assert.equal((await call('/nilai/7', as('dosen1', { method: 'PUT', body: { nilai: 0 } }))).status, 409);
  });

  await t.test('kegagalan menulis audit menghentikan request sebelum nilai berubah', async () => {
    db.prepare('INSERT INTO classes (id,code,name,credits,lecturer_id) VALUES (4,?,?,3,?)').run('TEST-AUDIT', 'Audit failure', 'dosen1');
    db.prepare('INSERT INTO grades (id,class_id,student_id,score) VALUES (8,4,?,55)').run('mhs1');
    db.exec("CREATE TRIGGER test_audit_failure BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END;");
    try {
      const result = await call('/nilai/8', as('dosen1', { method: 'PUT', body: { nilai: 99 } }));
      assert.equal(result.status, 503); assert.equal(result.data.error.code, 'AUDIT_UNAVAILABLE');
      assert.equal(db.prepare('SELECT score FROM grades WHERE id=8').get().score, 55);
    } finally { db.exec('DROP TRIGGER test_audit_failure'); }
  });

  await t.test('refresh rotasi atomik; logout mencabut refresh dan access token yang masih hidup', async () => {
    const body = { refresh_token: sessions.mhs2.refresh };
    assert.equal((await call('/auth/refresh', { method: 'POST', device: 'mhs1-laptop', body })).status, 403);
    const results = await Promise.all([1, 2].map(() => call('/auth/refresh', { method: 'POST', device: 'mhs2-laptop', body })));
    assert.deepEqual(results.map(x => x.status).sort(), [200, 401]);
    const fresh = results.find(x => x.status === 200).data;
    assert.notEqual(fresh.refresh_token, body.refresh_token);
    assert.equal((await call('/auth/logout', { method: 'POST', device: 'mhs2-laptop', body: { refresh_token: fresh.refresh_token } })).status, 200);
    assert.equal((await call('/auth/refresh', { method: 'POST', device: 'mhs2-laptop', body: { refresh_token: fresh.refresh_token } })).status, 401);
    assert.equal((await call('/nilai', { token: fresh.access_token, device: 'mhs2-laptop' })).status, 401);
    assert.equal((await call('/nilai', as('mhs2'))).status, 401);
    const expired = await login('mhs2'); clock = new Date('2026-10-29T03:00:01Z');
    assert.equal((await call('/auth/refresh', { method: 'POST', device: 'mhs2-laptop', body: { refresh_token: expired.data.refresh_token } })).status, 401);
    clock = new Date('2026-10-28T03:00:00Z');
  });

  await t.test('device dicabut dan role berubah langsung berlaku walaupun JWT belum expired', async () => {
    db.prepare("UPDATE devices SET active=0 WHERE user_id='mhs3'").run();
    assert.equal((await call('/nilai', as('mhs3'))).status, 403);
    db.prepare("UPDATE devices SET active=1 WHERE user_id='mhs3'").run();
    db.prepare("UPDATE users SET role='admin' WHERE id='mhs3'").run();
    assert.equal((await call('/nilai', as('mhs3'))).status, 401);
  });

  await t.test('JSON malformed/default deny diaudit tanpa membocorkan secret', async () => {
    assert.equal((await call('/nilai/1', as('dosen1', { method: 'PUT', raw: '{oops' }))).status, 400);
    assert.equal((await call('/unknown', as('mhs1'))).status, 404);
    assert.equal((await call('/auth/login', { method: 'GET' })).status, 401);
    const rows = db.prepare('SELECT * FROM audit_logs').all();
    assert.ok(rows.some(x => x.decision === 'deny' && x.endpoint === '/unknown'));
    assert.ok(rows.some(x => x.reason === 'INVALID_JSON'));
    assert.ok(rows.every(x => x.time && x.request_id && x.subject && x.reason && x.status));
    const serialized = JSON.stringify(rows);
    for (const secret of ['Praktikum123!', config.jwtSecret, config.gatewaySecret, config.serviceClientSecret,
      sessions.mhs1.token, sessions.mhs1.refresh]) assert.ok(!serialized.includes(secret));
  });
});
