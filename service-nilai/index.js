import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readEnvironment } from '../config.js';
import { openDatabase, transaction } from '../database/db.js';
import {
  baseApp, jsonBody, errorHandler, notFound, runServer, HttpError, numericId, onlyFields,
  assertAccess, classWriteDecision, nilaiReadDecision, verifyGateway,
} from '../shared/index.js';

function listGrades(db, principal) {
  assertAccess(nilaiReadDecision(principal));
  const filter = principal.role === 'mahasiswa' ? 'g.student_id=?' : 'c.lecturer_id=?';
  return db.prepare(`SELECT g.id, g.class_id AS kelas_id, c.code AS kode_mk, c.name AS mata_kuliah,
    u.nim, u.name AS mahasiswa, g.score AS nilai, c.finalized_at AS final_at, c.sync_status, g.updated_at
    FROM grades g JOIN classes c ON c.id=g.class_id JOIN users u ON u.id=g.student_id
    WHERE ${filter} ORDER BY g.id`).all(principal.id);
}

function updateGrade(db, config, now, principal, id, score) {
  const kelas = db.prepare('SELECT c.* FROM grades g JOIN classes c ON c.id=g.class_id WHERE g.id=?').get(id);
  assertAccess(classWriteDecision(principal, kelas, config, now(), { edit: true }));
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) {
    throw new HttpError(400, 'INVALID_SCORE', 'Nilai harus angka 0 sampai 100.');
  }
  const result = db.prepare(`UPDATE grades SET score=?, updated_at=? WHERE id=? AND class_id IN
    (SELECT id FROM classes WHERE lecturer_id=? AND finalized_at IS NULL)`)
    .run(score, now().toISOString(), id, principal.id);
  if (!result.changes) throw new HttpError(409, 'GRADE_UPDATE_CONFLICT', 'Nilai final atau hak akses telah berubah.');
  return { id, nilai: score };
}

async function synchronizeTranscript(config, classId) {
  const auth = await fetch(config.gatewayUrl + '/auth/service', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: config.serviceClientId, client_secret: config.serviceClientSecret }),
    signal: AbortSignal.timeout(config.timeoutMs), redirect: 'error',
  });
  if (!auth.ok) throw new Error('Service authentication failed');
  const token = await auth.json();
  const response = await fetch(config.gatewayUrl + '/transkrip/sinkron', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.access_token}` },
    body: JSON.stringify({ kelas_id: classId }),
    signal: AbortSignal.timeout(config.timeoutMs + 500), redirect: 'error',
  });
  if (!response.ok) throw new Error('Transcript sync failed');
  return response.json();
}

async function finalizeClass(db, config, now, principal, id) {
  transaction(db, () => {
    const kelas = db.prepare('SELECT * FROM classes WHERE id=?').get(id);
    assertAccess(classWriteDecision(principal, kelas, config, now()));
    const counts = db.prepare('SELECT COUNT(*) total, COUNT(score) filled FROM grades WHERE class_id=?').get(id);
    if (!counts.total || counts.total !== counts.filled) {
      throw new HttpError(409, 'GRADES_INCOMPLETE', 'Seluruh nilai kelas harus diisi sebelum finalisasi.');
    }
    if (!kelas.finalized_at) {
      db.prepare("UPDATE classes SET finalized_at=?, sync_status='pending' WHERE id=?").run(now().toISOString(), id);
    }
  });
  try { await synchronizeTranscript(config, id); }
  catch {
    throw new HttpError(502, 'TRANSCRIPT_SYNC_PENDING', 'Nilai sudah final dan terkunci. Sinkron belum terkonfirmasi; ulangi endpoint finalisasi setelah service tersedia.');
  }
  return { message: 'Nilai final dan transkrip tersinkron.', kelas_id: id, sync_status: 'synced' };
}

export function createNilai({ db, config, now = () => new Date() }) {
  const app = baseApp();
  app.use(verifyGateway({ db, config, now }));
  app.use(jsonBody());
  app.get('/nilai', (req, res) => res.json({ data: listGrades(db, req.principal) }));
  app.put('/nilai/:id', (req, res) => {
    const id = numericId(req.params.id);
    onlyFields(req.body, ['nilai']);
    res.json({ message: 'Nilai diperbarui.', data: updateGrade(db, config, now, req.principal, id, req.body.nilai) });
  });
  app.post('/kelas/:id/finalisasi', async (req, res) => {
    const id = numericId(req.params.id);
    onlyFields(req.body, [], { optional: true });
    res.json(await finalizeClass(db, config, now, req.principal, id));
  });
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const config = readEnvironment();
  const db = openDatabase(config.dbPath);
  runServer(createNilai({ db, config }), db, config.nilaiPort, config.host, 'Service Nilai');
}
