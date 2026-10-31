import { readEnvironment } from '../config.js';
import { openDatabase } from '../database/db.js';
import { seedDatabase } from '../database/seed.js';
try {
  const db = openDatabase(readEnvironment().dbPath);
  try { console.log(seedDatabase(db) ? 'Seed berhasil: 6 akun, 2 kelas, 6 nilai.' : 'Data sudah ada. Tidak ditimpa.'); }
  finally { db.close(); }
} catch (error) { console.error(error.message); process.exitCode = 1; }
