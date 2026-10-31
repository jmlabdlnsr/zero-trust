import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readEnvironment } from '../config.js';
import { openDatabase } from '../database/db.js';
import { baseApp, jsonBody, errorHandler, runServer, HttpError, assertAccess } from '../shared/index.js';
import { verifyUser } from './middleware/verify-user.js';
import { decideAccess } from './policy.js';
import { authRoutes } from './routes/auth.js';

function auditMiddleware(db, now) {
  return (req, res, next) => {
    req.auditSubject = 'anonymous';
    let logId;
    req.recordDecision = (decision, reason) => {
      if (logId) return;
      const result = db.prepare(`INSERT INTO audit_logs
        (time,request_id,subject,method,endpoint,device,decision,reason) VALUES (?,?,?,?,?,?,?,?)`)
        .run(now().toISOString(), req.requestId, req.auditSubject, req.method, req.path.slice(0, 512),
          req.get('X-Device-ID')?.slice(0, 128) || null, decision, reason);
      logId = result.lastInsertRowid;
    };
    res.on('finish', () => {
      try { if (logId) db.prepare('UPDATE audit_logs SET status=? WHERE id=?').run(res.statusCode, logId); }
      catch { console.error('Gagal memperbarui status audit.'); }
    });
    next();
  };
}

function authorization({ db, config, now }) {
  return (req, res, next) => {
    try {
      const decision = decideAccess({
        db, config, claims: req.claims, deviceId: req.get('X-Device-ID'),
        method: req.method, path: req.path, now: now(),
      });
      assertAccess(decision);
      req.recordDecision('allow', decision.reason);
      req.accessDecision = decision;
      next();
    } catch (error) { next(error); }
  };
}

function forwardRequest({ config }) {
  return async (req, res, next) => {
    const target = req.accessDecision.target;
    const base = target === 'nilai' ? config.nilaiUrl : config.transkripUrl;
    try {
      const response = await fetch(base + req.path, {
        method: req.method,
        headers: {
          Authorization: `Bearer ${req.accessToken}`,
          'X-Gateway-Secret': config.gatewaySecret,
          ...(req.get('X-Device-ID') ? { 'X-Device-ID': req.get('X-Device-ID') } : {}),
          ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: ['GET', 'HEAD'].includes(req.method) || req.body === undefined ? undefined : JSON.stringify(req.body),
        signal: AbortSignal.timeout(target === 'nilai' ? config.timeoutMs * 3 + 1000 : config.timeoutMs),
        redirect: 'error',
      });
      res.status(response.status).json(await response.json());
    } catch {
      next(new HttpError(502, 'UPSTREAM_UNAVAILABLE', 'Service tidak dapat dihubungi.'));
    }
  };
}

export function createGateway({ db, config, now = () => new Date() }) {
  const app = baseApp();
  app.use(auditMiddleware(db, now));
  app.use(jsonBody());
  app.use(authRoutes({ db, config, now }));
  app.use(verifyUser({ config, now }));
  app.use(authorization({ db, config, now }));
  app.use(forwardRequest({ config }));
  app.use(errorHandler);
  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const config = readEnvironment();
  const db = openDatabase(config.dbPath);
  runServer(createGateway({ db, config }), db, config.gatewayPort, config.host, 'Gateway');
}
