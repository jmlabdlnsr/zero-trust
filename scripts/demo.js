import assert from 'node:assert/strict';
import { readEnvironment } from '../config.js';
import { getSeedPasswords } from '../database/seed.js';
import { isWithinAccessHours } from '../shared/index.js';

const config = readEnvironment();
const seedPasswords = getSeedPasswords();
const passwordFor = {
  mhs1: seedPasswords.mhs1,
  dosen1: seedPasswords.dosen1,
  dosen2: seedPasswords.dosen2,
  admin: seedPasswords.admin,
};
let checks = 0;
async function request(label, path, { method = 'GET', body, token, device, base = config.gatewayUrl, expected = 200 } = {}) {
  const response = await fetch(base + path, { method, headers: {
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(device ? { 'X-Device-ID': device } : {}),
  }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const data = await response.json();
  assert.equal(response.status, expected, `${label}: ${JSON.stringify(data)}`);
  checks++; console.log(`[OK ${response.status}] ${label}`); return data;
}
async function login(user) {
  const result = await request(`Login ${user}`, '/auth/login', { method: 'POST', device: `${user}-laptop`, body: { username: user, password: passwordFor[user] } });
  return { token: result.access_token, refresh: result.refresh_token, device: `${user}-laptop` };
}
try {
  console.log('Demo memakai database aktif. Nilai kelas 1 akan difinalisasi jika jam akses mengizinkan.');
  await request('Tanpa token ditolak', '/nilai', { expected: 401 });
  const student = await login('mhs1'), lecturer = await login('dosen1'), other = await login('dosen2'), admin = await login('admin');
  await request('Mahasiswa melihat nilainya', '/nilai', student);
  await request('Transkrip mahasiswa lain ditolak', '/transkrip/237006002', { ...student, expected: 403 });
  await request('Device asing ditolak', '/nilai', { ...student, device: 'asing', expected: 403 });
  await request('Dosen lain tidak bisa edit kelas 1', '/nilai/1', { ...other, method: 'PUT', body: { nilai: 90 }, expected: 403 });
  await request('Token admin tidak bisa sinkron', '/transkrip/sinkron', { ...admin, method: 'POST', body: { kelas_id: 1 }, expected: 403 });
  await request('Akses langsung service ditolak', '/nilai', { ...student, base: config.nilaiUrl, expected: 403 });
  if (isWithinAccessHours(new Date(), config)) {
    const grades = await request('Dosen melihat kelasnya', '/nilai', lecturer);
    const final = Boolean(grades.data.find(x => x.id === 1).final_at);
    await request(final ? 'Nilai final tetap terkunci' : 'Dosen mengubah nilai', '/nilai/1', {
      ...lecturer, method: 'PUT', body: { nilai: 95 }, expected: final ? 409 : 200,
    });
    await request('Finalisasi dan sinkron melalui gateway', '/kelas/1/finalisasi', { ...lecturer, method: 'POST' });
    await request('Edit setelah finalisasi ditolak', '/nilai/1', { ...lecturer, method: 'PUT', body: { nilai: 10 }, expected: 409 });
    const transcript = await request('Mahasiswa melihat transkrip final', '/transkrip/237006001', student);
    console.table(transcript.data);
  } else {
    await request('Edit di luar jam akses ditolak', '/nilai/1', { ...lecturer, method: 'PUT', body: { nilai: 95 }, expected: 403 });
    await request('Finalisasi di luar jam akses ditolak', '/kelas/1/finalisasi', { ...lecturer, method: 'POST', expected: 403 });
    console.log('Untuk demo alur sukses: set ACCESS_START=00:00 dan ACCESS_END=24:00 di .env, lalu restart server.');
  }
  await request('Admin dapat melihat transkrip', '/transkrip/237006002', admin);
  const refreshed = await request('Rotasi refresh token', '/auth/refresh', { method: 'POST', device: student.device, body: { refresh_token: student.refresh } });
  await request('Refresh lama ditolak', '/auth/refresh', { method: 'POST', device: student.device, body: { refresh_token: student.refresh }, expected: 401 });
  await request('Logout mencabut sesi', '/auth/logout', { method: 'POST', device: student.device, body: { refresh_token: refreshed.refresh_token } });
  await request('Token akses setelah logout ditolak', '/nilai', { ...student, token: refreshed.access_token, expected: 401 });
  for (const session of [lecturer, other, admin]) await request('Tutup sesi demo', '/auth/logout', { method: 'POST', device: session.device, body: { refresh_token: session.refresh } });
  console.log(`\nSelesai: ${checks} pemeriksaan HTTP lulus. Jalankan npm run audit.`);
} catch (error) { console.error(`Demo gagal: ${error.message}\nPastikan npm start sudah berjalan dan konfigurasi server sama.`); process.exitCode = 1; }
