import express from 'express';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createIdentityRepository } from '../database/db.js';

export class HttpError extends Error {
  constructor(status, code, message = code) { super(message); this.status = status; this.code = code; }
}

export function baseApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('case sensitive routing', true);
  app.set('strict routing', true);
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.set({ 'X-Request-ID': req.requestId, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    next();
  });
  return app;
}

export function jsonBody() {
  return [
    (req, res, next) => {
      const hasBody = Number(req.get('Content-Length') || 0) > 0 || Boolean(req.get('Transfer-Encoding'));
      if (hasBody && !req.is('application/json')) {
        return next(new HttpError(415, 'JSON_CONTENT_TYPE_REQUIRED', 'Body harus memakai Content-Type: application/json.'));
      }
      next();
    },
    express.json({ limit: '16kb', strict: true }),
  ];
}

export function onlyFields(body, fields, { optional = false } = {}) {
  if (optional && body === undefined) return;
  if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(key => !fields.includes(key))) {
    throw new HttpError(400, 'INVALID_BODY', `Body hanya boleh berisi: ${fields.join(', ') || '(kosong)'}.`);
  }
}

export function requiredString(value, label, max = 256) {
  if (typeof value !== 'string' || !value.length || value.length > max) {
    throw new HttpError(400, 'INVALID_BODY', `${label} tidak valid.`);
  }
  return value;
}

export function numericId(value) {
  const id = typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, 'ID_INVALID', 'ID harus bilangan bulat positif.');
  return id;
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  let status = error instanceof HttpError ? error.status : 500;
  let code = error instanceof HttpError ? error.code : 'INTERNAL_ERROR';
  let message = error instanceof HttpError ? error.message : 'Terjadi kesalahan internal.';
  if (error.type === 'entity.parse.failed') { status = 400; code = 'INVALID_JSON'; message = 'Body JSON tidak valid.'; }
  if (error.type === 'entity.too.large') { status = 413; code = 'BODY_TOO_LARGE'; message = 'Body maksimal 16 KB.'; }
  if (!(error instanceof HttpError) && error.status === 415) {
    status = 415; code = 'UNSUPPORTED_ENCODING'; message = 'Encoding body tidak didukung.';
  }
  try { req.recordDecision?.('deny', code); }
  catch { status = 503; code = 'AUDIT_UNAVAILABLE'; message = 'Audit tidak tersedia; akses dihentikan.'; }
  res.status(status).json({ error: { code, message }, request_id: req.requestId });
}

export const notFound = (req, res, next) => next(new HttpError(404, 'ENDPOINT_NOT_ALLOWED'));

export function runServer(app, db, port, host, label) {
  const server = app.listen(port, host, () => console.log(`${label} siap di http://${host}:${port}`));
  server.on('error', error => { console.error(`${label} gagal: ${error.code}`); db.close(); process.exitCode = 1; });
  const shutdown = () => { server.closeAllConnections(); server.close(() => { db.close(); process.exit(0); }); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return server;
}

export function deny(status, reason) { return { allowed: false, status, reason }; }
export function allow(reason) { return { allowed: true, status: 200, reason }; }

export function isWithinAccessHours(date, config) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const minutes = Number(parts.find(part => part.type === 'hour').value) * 60
    + Number(parts.find(part => part.type === 'minute').value);
  const parse = value => { const [hour, minute] = value.split(':').map(Number); return hour * 60 + minute; };
  const start = parse(config.accessStart), end = parse(config.accessEnd);
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

export function nilaiReadDecision(principal) {
  return ['mahasiswa', 'dosen'].includes(principal.role) ? allow('OWN_GRADES_ONLY') : deny(403, 'ROLE_DENIED');
}

export function transcriptReadDecision(principal, nim) {
  return principal.role === 'admin' || (principal.role === 'mahasiswa' && principal.nim === nim)
    ? allow('TRANSCRIPT_READ_ALLOWED') : deny(403, 'TRANSCRIPT_OWNER_REQUIRED');
}

export function transcriptSyncDecision(principal) {
  return principal.role === 'service' ? allow('SERVICE_SYNC_ALLOWED') : deny(403, 'SERVICE_TOKEN_REQUIRED');
}

export function classWriteDecision(principal, kelas, config, now, { edit = false } = {}) {
  if (principal.role !== 'dosen') return deny(403, 'LECTURER_REQUIRED');
  if (!kelas || kelas.lecturer_id !== principal.id) return deny(403, 'CLASS_OWNER_REQUIRED');
  if (!isWithinAccessHours(now, config)) return deny(403, 'OUTSIDE_ACCESS_HOURS');
  if (edit && kelas.finalized_at) return deny(409, 'GRADE_ALREADY_FINAL');
  return allow(edit ? 'GRADE_UPDATE_ALLOWED' : 'CLASS_FINALIZE_ALLOWED');
}

export function assertAccess(decision) {
  if (!decision.allowed) throw new HttpError(decision.status, decision.reason);
}

export function currentPrincipal({ db, config, claims, deviceId, now = new Date() }) {
  if (claims.type === 'service') {
    return claims.role === 'service' && claims.sub === config.serviceClientId
      ? { principal: { id: claims.sub, role: 'service' } } : deny(403, 'SERVICE_IDENTITY_INVALID');
  }
  const repository = createIdentityRepository(db);
  const user = repository.findUser(claims.sub);
  if (claims.type !== 'access' || !user?.active || user.role !== claims.role) return deny(401, 'USER_OR_ROLE_INVALID');
  if (typeof deviceId !== 'string' || deviceId.length > 128 || claims.device !== deviceId
    || !repository.hasActiveDevice(user.id, deviceId)) return deny(403, 'DEVICE_NOT_REGISTERED');
  const session = typeof claims.sid === 'string' && repository.findSession(claims.sid);
  if (!session || session.user_id !== user.id || session.device_id !== deviceId
    || session.revoked_at !== null || session.expires_at <= epoch(now)) return deny(401, 'SESSION_REVOKED_OR_EXPIRED');
  return { principal: user };
}

export function equalSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password, hash) {
  const [salt, digest] = hash.split(':');
  const computed = scryptSync(password, salt, 64);
  const expected = Buffer.from(digest, 'hex');
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

export const hashRefreshToken = token => createHash('sha256').update(token).digest('hex');
export const newRefreshToken = () => randomBytes(48).toString('base64url');
export const epoch = (date = new Date()) => Math.floor(date.getTime() / 1000);

export function issueToken(payload, config, now = new Date()) {
  return jwt.sign({ ...payload, iat: epoch(now) }, config.jwtSecret, {
    algorithm: 'HS256', expiresIn: payload.type === 'service' ? 300 : 600,
    issuer: config.issuer, audience: config.audience, jwtid: randomUUID(),
  });
}

export function verifyToken(token, config, now = new Date()) {
  const claims = jwt.verify(token, config.jwtSecret, {
    algorithms: ['HS256'], issuer: config.issuer, audience: config.audience, clockTimestamp: epoch(now),
  });
  if (!claims || typeof claims !== 'object' || typeof claims.sub !== 'string' || !Number.isInteger(claims.exp)
    || !Number.isInteger(claims.iat) || claims.iat > epoch(now) || !['access', 'service'].includes(claims.type)
    || (claims.type === 'service' ? claims.role !== 'service' : !['admin', 'dosen', 'mahasiswa'].includes(claims.role))) {
    throw new Error('Klaim token tidak valid.');
  }
  return claims;
}

export function bearerToken(header) {
  if (typeof header !== 'string' || !/^Bearer [^\s]+$/i.test(header)) {
    throw new Error('Authorization Bearer wajib disertakan.');
  }
  return header.slice(7);
}

export function verifyGateway({ db, config, now = () => new Date() }) {
  return (req, res, next) => {
    if (!equalSecret(req.get('X-Gateway-Secret'), config.gatewaySecret)) {
      return next(new HttpError(403, 'GATEWAY_REQUIRED', 'Akses wajib melalui gateway.'));
    }
    let claims;
    try { claims = verifyToken(bearerToken(req.get('Authorization')), config, now()); }
    catch { return next(new HttpError(401, 'INVALID_TOKEN', 'Token tidak valid atau kedaluwarsa.')); }
    const identity = currentPrincipal({ db, config, claims, deviceId: req.get('X-Device-ID'), now: now() });
    if (!identity.principal) return next(new HttpError(identity.status, identity.reason));
    req.principal = identity.principal;
    req.claims = claims;
    next();
  };
}
