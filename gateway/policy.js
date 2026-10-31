import { currentPrincipal, deny, nilaiReadDecision, transcriptReadDecision, transcriptSyncDecision, classWriteDecision } from '../shared/index.js';

// Policy Engine: endpoint, identitas, dan atribut database menentukan akses.
export function decideAccess({ db, config, claims, deviceId, method, path, now = new Date() }) {
  const identity = currentPrincipal({ db, config, claims, deviceId, now });
  if (!identity.principal) return identity;
  const principal = identity.principal;
  const route = (decision, target) => decision.allowed ? { ...decision, principal, target } : decision;

  if (method === 'POST' && path === '/transkrip/sinkron') {
    return route(transcriptSyncDecision(principal), 'transkrip');
  }
  if (principal.role === 'service') return deny(403, 'SERVICE_SCOPE_DENIED');
  if (method === 'GET' && path === '/nilai') return route(nilaiReadDecision(principal), 'nilai');

  const transcript = /^\/transkrip\/(\d+)$/.exec(path);
  if (method === 'GET' && transcript) return route(transcriptReadDecision(principal, transcript[1]), 'transkrip');

  const grade = /^\/nilai\/([1-9]\d*)$/.exec(path);
  const finalize = /^\/kelas\/([1-9]\d*)\/finalisasi$/.exec(path);
  if ((method === 'PUT' && grade) || (method === 'POST' && finalize)) {
    if (principal.role !== 'dosen') return deny(403, 'LECTURER_REQUIRED');
    const id = Number((grade || finalize)[1]);
    if (!Number.isSafeInteger(id)) return deny(400, 'ID_INVALID');
    const kelas = grade
      ? db.prepare('SELECT c.* FROM grades g JOIN classes c ON c.id=g.class_id WHERE g.id=?').get(id)
      : db.prepare('SELECT * FROM classes WHERE id=?').get(id);
    return route(classWriteDecision(principal, kelas, config, now, { edit: Boolean(grade) }), 'nilai');
  }
  return deny(404, 'ENDPOINT_NOT_ALLOWED');
}
