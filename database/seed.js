import { transaction } from './db.js';
import { hashPassword } from '../shared/index.js';

const passwordKeys = {
  admin: 'SEED_ADMIN_PASSWORD',
  dosen1: 'SEED_DOSEN01_PASSWORD',
  dosen2: 'SEED_DOSEN02_PASSWORD',
  mhs1: 'SEED_MHS01_PASSWORD',
  mhs2: 'SEED_MHS02_PASSWORD',
  mhs3: 'SEED_MHS03_PASSWORD',
};

export function getSeedPasswords(env = process.env) {
  return Object.fromEntries(Object.entries(passwordKeys).map(([userId, key]) => {
    const password = env[key];
    if (typeof password !== 'string' || password.length < 12
      || /^(GANTI_|GENERATE_)/i.test(password)) {
      throw new Error(`${key} wajib diisi dengan password demo minimal 12 karakter di .env.`);
    }
    return [userId, password];
  }));
}

// Buat akun, device, kelas, dan nilai awal.
export function seedDatabase(db, env = process.env) {
  if (db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) return false;
  const passwords = getSeedPasswords(env);
  transaction(db, () => {
    const users = [
      ['admin', 'Admin Akademik', 'admin', null],
      ['dosen1', 'Dr. Andi Pratama', 'dosen', null],
      ['dosen2', 'Dr. Siti Rahma', 'dosen', null],
      ['mhs1', 'Budi Santoso', 'mahasiswa', '237006001'],
      ['mhs2', 'Citra Lestari', 'mahasiswa', '237006002'],
      ['mhs3', 'Dimas Saputra', 'mahasiswa', '237006003'],
    ];
    for (const [id, name, role, nim] of users) {
      db.prepare('INSERT INTO users (id,username,name,password_hash,role,nim) VALUES (?,?,?,?,?,?)')
        .run(id, id, name, hashPassword(passwords[id]), role, nim);
      db.prepare('INSERT INTO devices (user_id,device_id) VALUES (?,?)').run(id, `${id}-laptop`);
    }
    db.prepare('INSERT INTO classes (id,code,name,credits,lecturer_id) VALUES (1,?,?,3,?)')
      .run('KP70065004', 'Keamanan Informasi', 'dosen1');
    db.prepare('INSERT INTO classes (id,code,name,credits,lecturer_id) VALUES (2,?,?,3,?)')
      .run('IF-BD-01', 'Basis Data', 'dosen2');
    for (const row of [[1,1,'mhs1',80],[2,1,'mhs2',75],[3,1,'mhs3',90],[4,2,'mhs1',70],[5,2,'mhs2',85],[6,2,'mhs3',88]]) {
      db.prepare('INSERT INTO grades (id,class_id,student_id,score) VALUES (?,?,?,?)').run(...row);
    }
  });
  return true;
}
