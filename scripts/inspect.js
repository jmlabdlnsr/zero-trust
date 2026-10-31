import { readEnvironment } from '../config.js';
import { openDatabase } from '../database/db.js';
try {
  const db = openDatabase(readEnvironment().dbPath);
  try {
    if (process.argv[2] === 'audit') console.table(db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 50').all());
    else {
      console.log('Akun dan device (password/secret tidak ditampilkan)');
      console.table(db.prepare('SELECT u.id,u.name,u.role,u.nim,d.device_id,d.active AS device_active FROM users u JOIN devices d ON d.user_id=u.id').all());
      console.log('Kelas'); console.table(db.prepare('SELECT * FROM classes').all());
      console.log('Nilai'); console.table(db.prepare('SELECT * FROM grades').all());
      console.log('Transkrip'); console.table(db.prepare('SELECT * FROM transcripts').all());
      console.log('Jalankan npm run audit untuk melihat keputusan gateway.');
    }
  } finally { db.close(); }
} catch (error) { console.error(error.message); process.exitCode = 1; }
