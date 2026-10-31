import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { readEnvironment } from '../config.js';
import { openDatabase } from '../database/db.js';
import { getSeedPasswords, seedDatabase } from '../database/seed.js';

try {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major !== 24 || minor < 13) throw new Error('Gunakan Node.js 24 LTS, minimal 24.13.0.');
  let createdEnvironment = false;
  if (!existsSync('.env')) {
    let template = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
    template = template.replace(/^(JWT_SECRET|GATEWAY_SECRET|SERVICE_CLIENT_SECRET)=.*$/gm,
      (_, key) => `${key}=${randomBytes(48).toString('hex')}`);
    writeFileSync('.env', template, { flag: 'wx', mode: 0o600 });
    console.log('.env dibuat dengan tiga secret acak.');
    createdEnvironment = true;
  } else console.log('.env sudah ada; konfigurasi dipertahankan.');
  const config = readEnvironment();
  let passwordsConfigured = true;
  try { getSeedPasswords(); }
  catch (error) {
    if (!createdEnvironment) throw error;
    console.log(error.message);
    passwordsConfigured = false;
  }
  if (!passwordsConfigured) {
    console.log('Isi keenam SEED_*_PASSWORD di .env, lalu jalankan npm run setup lagi.');
  } else {
    const db = openDatabase(config.dbPath);
    try { console.log(seedDatabase(db) ? 'Database dan 6 akun demo berhasil dibuat.' : 'Database sudah berisi data; tidak ditimpa.'); }
    finally { db.close(); }
    console.log(`Database: ${config.dbPath}\nBerikutnya: npm start\nAkun dan device: lihat README.md.`);
  }
} catch (error) { console.error(`Setup gagal: ${error.message}`); process.exitCode = 1; }
