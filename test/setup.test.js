import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

test('setup pertama membuat .env tanpa membuat database sebelum password demo diisi', () => {
  const directory = mkdtempSync(join(tmpdir(), 'zero-trust-first-setup-'));
  const script = fileURLToPath(new URL('../scripts/setup.js', import.meta.url));
  const env = { ...process.env };
  for (const key of ['DB_PATH', 'JWT_SECRET', 'GATEWAY_SECRET', 'SERVICE_CLIENT_SECRET',
    'SEED_ADMIN_PASSWORD', 'SEED_DOSEN01_PASSWORD', 'SEED_DOSEN02_PASSWORD',
    'SEED_MHS01_PASSWORD', 'SEED_MHS02_PASSWORD', 'SEED_MHS03_PASSWORD']) delete env[key];
  try {
    const first = spawnSync(process.execPath, [script], { cwd: directory, env, encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Isi keenam SEED_\*_PASSWORD di \.env/);
    assert.ok(!first.stdout.includes('Setup gagal'));
    assert.ok(!existsSync(join(directory, 'data')));
    const envPath = join(directory, '.env');
    let configuration = readFileSync(envPath, 'utf8');
    const passwords = {
      SEED_ADMIN_PASSWORD: 'AdminDemoPass12!',
      SEED_DOSEN01_PASSWORD: 'DosenSatuPass12!',
      SEED_DOSEN02_PASSWORD: 'DosenDuaPass12!',
      SEED_MHS01_PASSWORD: 'MhsSatuDemoPass12!',
      SEED_MHS02_PASSWORD: 'MhsDuaDemoPass12!',
      SEED_MHS03_PASSWORD: 'MhsTigaDemoPass12!',
    };
    for (const [key, password] of Object.entries(passwords)) {
      configuration = configuration.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${password}`);
    }
    writeFileSync(envPath, configuration);
    const second = spawnSync(process.execPath, [script], { cwd: directory, env, encoding: 'utf8' });
    assert.equal(second.status, 0, second.stderr);
    const db = new DatabaseSync(join(directory, 'data/zero-trust.sqlite'));
    try { assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 6); }
    finally { db.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('setup membuat secret/database dan tidak mengganti secret atau nilai ketika dijalankan ulang', () => {
  const directory = mkdtempSync(join(tmpdir(), 'zero-trust-setup-'));
  const script = fileURLToPath(new URL('../scripts/setup.js', import.meta.url));
  const env = { ...process.env };
  for (const key of ['DB_PATH', 'JWT_SECRET', 'GATEWAY_SECRET', 'SERVICE_CLIENT_SECRET']) delete env[key];
  Object.assign(env, {
    SEED_ADMIN_PASSWORD: 'AdminDemoPass12!',
    SEED_DOSEN01_PASSWORD: 'DosenSatuPass12!',
    SEED_DOSEN02_PASSWORD: 'DosenDuaPass12!',
    SEED_MHS01_PASSWORD: 'MhsSatuDemoPass12!',
    SEED_MHS02_PASSWORD: 'MhsDuaDemoPass12!',
    SEED_MHS03_PASSWORD: 'MhsTigaDemoPass12!',
  });
  try {
    const first = spawnSync(process.execPath, [script], { cwd: directory, env, encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    const original = readFileSync(join(directory, '.env'), 'utf8');
    const secrets = [...original.matchAll(/^(?:JWT_SECRET|GATEWAY_SECRET|SERVICE_CLIENT_SECRET)=(.+)$/gm)].map(x => x[1]);
    assert.equal(new Set(secrets).size, 3); assert.ok(secrets.every(x => x.length >= 64));
    const db = new DatabaseSync(join(directory, 'data/zero-trust.sqlite'));
    db.prepare('UPDATE grades SET score=99 WHERE id=1').run(); db.close();
    const second = spawnSync(process.execPath, [script], { cwd: directory, env, encoding: 'utf8' });
    assert.equal(second.status, 0, second.stderr);
    assert.equal(readFileSync(join(directory, '.env'), 'utf8'), original);
    const check = new DatabaseSync(join(directory, 'data/zero-trust.sqlite'));
    try {
      assert.equal(check.prepare('SELECT COUNT(*) n FROM users').get().n, 6);
      assert.equal(check.prepare('SELECT score FROM grades WHERE id=1').get().score, 99);
    } finally { check.close(); }
    assert.ok(!secrets.some(x => (first.stdout + second.stdout).includes(x)));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
