import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readEnvironment } from '../config.js';
import { openDatabase } from '../database/db.js';

try {
  const config = readEnvironment();
  const db = openDatabase(config.dbPath);
  const seeded = db.prepare('SELECT COUNT(*) n FROM users').get().n > 0; db.close();
  if (!seeded) throw new Error('Database masih kosong. Jalankan npm run setup.');
  console.log('Menjalankan tiga proses. Tekan Ctrl+C atau ketik q lalu Enter untuk menghentikan semuanya.');
  const children = [];
  const stoppedChildren = new Set();
  let stopping = false;
  function shutdown(code = 0) {
    if (stopping) return; stopping = true; process.exitCode = code;
    process.stdin.pause();
    for (const child of children) if (child.exitCode === null) child.kill();
  }
  function exitWhenStopped() {
    if (stopping && stoppedChildren.size === children.length) process.exit(process.exitCode || 0);
  }
  for (const service of ['gateway', 'service-nilai', 'service-transkrip']) {
    const child = spawn(process.execPath, [fileURLToPath(new URL(`../${service}/index.js`, import.meta.url))], {
      stdio: ['ignore', 'inherit', 'inherit'], env: process.env, windowsHide: true,
    });
    children.push(child);
    child.on('error', error => { console.error(`${service} gagal: ${error.message}`); shutdown(1); });
    child.on('exit', code => {
      if (!stopping) { console.error(`${service} berhenti (${code}). Menghentikan proses lain.`); shutdown(code || 1); }
    });
    child.on('close', () => {
      stoppedChildren.add(child);
      exitWhenStopped();
    });
  }
  process.once('SIGINT', () => shutdown()); process.once('SIGTERM', () => shutdown());
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', text => { if (text.trim().toLowerCase() === 'q') shutdown(); });
} catch (error) { console.error(`Tidak dapat menjalankan program: ${error.message}`); process.exitCode = 1; }
