import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readEnvironment } from '../config.js';
import { openDatabase, transaction } from '../database/db.js';
import {
  baseApp, jsonBody, errorHandler, notFound, runServer, HttpError, numericId, onlyFields,
  assertAccess, transcriptReadDecision, transcriptSyncDecision, verifyGateway,
} from '../shared/index.js';

function readTranscript(db, principal, nim) {
  assertAccess(transcriptReadDecision(principal, nim));
  const user = db.prepare("SELECT id,nim,name FROM users WHERE nim=? AND role='mahasiswa'").get(nim);
  if (!user) throw new HttpError(404, 'STUDENT_NOT_FOUND');
  const rows = db.prepare(`SELECT c.id AS kelas_id,c.code AS kode_mk,c.name AS mata_kuliah,c.credits AS sks,
    t.score AS nilai,t.synced_at FROM transcripts t JOIN classes c ON c.id=t.class_id
    WHERE t.student_id=? ORDER BY c.id`).all(user.id);
  return { mahasiswa: { nim: user.nim, nama: user.name }, data: rows };
}

function synchronize(db, principal, id, now) {
  assertAccess(transcriptSyncDecision(principal));
  const count = transaction(db, () => {
    const kelas = db.prepare('SELECT * FROM classes WHERE id=?').get(id);
    if (!kelas) throw new HttpError(404, 'CLASS_NOT_FOUND');
    if (!kelas.finalized_at) throw new HttpError(409, 'CLASS_NOT_FINAL');
    const grades = db.prepare('SELECT * FROM grades WHERE class_id=?').all(id);
    if (!grades.length || grades.some(grade => grade.score === null)) throw new HttpError(409, 'GRADES_INCOMPLETE');
    const timestamp = now().toISOString();
    const upsert = db.prepare(`INSERT INTO transcripts (grade_id,student_id,class_id,score,synced_at) VALUES (?,?,?,?,?)
      ON CONFLICT(grade_id) DO UPDATE SET score=excluded.score, synced_at=excluded.synced_at`);
    for (const grade of grades) upsert.run(grade.id, grade.student_id, id, grade.score, timestamp);
    db.prepare("UPDATE classes SET sync_status='synced', synced_at=? WHERE id=?").run(timestamp, id);
    return grades.length;
  });
  return { message: 'Transkrip tersinkron.', kelas_id: id, jumlah: count };
}

export function createTranskrip({ db, config, now = () => new Date() }) {
  const app = baseApp();
  app.use(verifyGateway({ db, config, now }));
  app.use(jsonBody());
  app.post('/transkrip/sinkron', (req, res) => {
    onlyFields(req.body, ['kelas_id']);
    if (typeof req.body.kelas_id !== 'number') throw new HttpError(400, 'ID_INVALID');
    res.json(synchronize(db, req.principal, numericId(req.body.kelas_id), now));
  });
  app.get('/transkrip/:nim', (req, res) => {
    if (!/^\d+$/.test(req.params.nim)) throw new HttpError(400, 'NIM_INVALID');
    res.json(readTranscript(db, req.principal, req.params.nim));
  });
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const config = readEnvironment();
  const db = openDatabase(config.dbPath);
  runServer(createTranskrip({ db, config }), db, config.transkripPort, config.host, 'Service Transkrip');
}
