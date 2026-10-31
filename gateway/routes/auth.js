import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { transaction } from '../../database/db.js';
import { HttpError, onlyFields, requiredString, equalSecret, epoch, hashPassword, hashRefreshToken, issueToken, newRefreshToken, verifyPassword } from '../../shared/index.js';

const dummyPasswordHash = hashPassword('dummy-password-for-timing');
const publicUser = user => ({ id: user.id, username: user.username, nama: user.name, role: user.role, nim: user.nim });

export function authRoutes({ db, config, now }) {
  const router = Router({ caseSensitive: true, strict: true });
  const audit = req => ({
    identify: subject => { req.auditSubject = subject; },
    allow: reason => req.recordDecision('allow', reason),
  });
  const activeDevice = (userId, deviceId) => typeof deviceId === 'string' && deviceId.length <= 128
    && Boolean(db.prepare('SELECT 1 FROM devices WHERE user_id=? AND device_id=? AND active=1').get(userId, deviceId));
  const tokenResponse = (user, sessionId, deviceId, refreshToken, expiresAt) => ({
    token_type: 'Bearer',
    access_token: issueToken({ sub: user.id, role: user.role, type: 'access', sid: sessionId, device: deviceId }, config, now()),
    expires_in: 600, refresh_token: refreshToken,
    refresh_expires_in: expiresAt - epoch(now()), user: publicUser(user),
  });

  router.post('/auth/login', (req, res) => {
    onlyFields(req.body, ['username', 'password']);
    const username = requiredString(req.body.username, 'username', 100);
    const password = requiredString(req.body.password, 'password', 1024);
    const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
    const valid = verifyPassword(password, user?.password_hash || dummyPasswordHash);
    if (!valid || !user?.active) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Username atau password salah.');
    req.auditSubject = user.id;
    const deviceId = req.get('X-Device-ID');
    if (!activeDevice(user.id, deviceId)) throw new HttpError(403, 'DEVICE_NOT_REGISTERED', 'Device tidak terdaftar atau sudah dicabut.');
    const sessionId = randomUUID(), refreshToken = newRefreshToken(), expiresAt = epoch(now()) + 86400;
    req.recordDecision('allow', 'LOGIN_ALLOWED');
    db.prepare('INSERT INTO sessions (id,user_id,device_id,refresh_hash,expires_at) VALUES (?,?,?,?,?)')
      .run(sessionId, user.id, deviceId, hashRefreshToken(refreshToken), expiresAt);
    res.json(tokenResponse(user, sessionId, deviceId, refreshToken, expiresAt));
  });

  for (const action of ['refresh', 'logout']) {
    router.post(`/auth/${action}`, (req, res) => {
      onlyFields(req.body, ['refresh_token']);
      const refreshHash = hashRefreshToken(requiredString(req.body.refresh_token, 'refresh_token', 512));
      const output = transaction(db, () => {
        const session = db.prepare('SELECT * FROM sessions WHERE refresh_hash=?').get(refreshHash);
        if (!session || session.revoked_at !== null || session.expires_at <= epoch(now())) {
          throw new HttpError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token tidak valid, kedaluwarsa, atau telah dicabut.');
        }
        req.auditSubject = session.user_id;
        const user = db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(session.user_id);
        if (!user) throw new HttpError(401, 'USER_INVALID');
        const deviceId = req.get('X-Device-ID');
        if (!activeDevice(user.id, deviceId)) throw new HttpError(403, 'DEVICE_NOT_REGISTERED', 'Device tidak terdaftar atau sudah dicabut.');
        if (deviceId !== session.device_id) throw new HttpError(403, 'DEVICE_MISMATCH');
        const refreshToken = newRefreshToken();
        if (action === 'logout') {
          db.prepare('UPDATE sessions SET revoked_at=? WHERE id=?').run(epoch(now()), session.id);
        } else {
          db.prepare('UPDATE sessions SET refresh_hash=? WHERE id=?').run(hashRefreshToken(refreshToken), session.id);
        }
        req.recordDecision('allow', action === 'logout' ? 'LOGOUT_ALLOWED' : 'REFRESH_ALLOWED');
        return action === 'logout'
          ? { message: 'Logout berhasil; sesi dan refresh token dicabut.' }
          : tokenResponse(user, session.id, deviceId, refreshToken, session.expires_at);
      });
      res.json(output);
    });
  }

  router.post('/auth/service', (req, res) => {
    onlyFields(req.body, ['client_id', 'client_secret']);
    const clientId = requiredString(req.body.client_id, 'client_id', 100);
    const clientSecret = requiredString(req.body.client_secret, 'client_secret', 1024);
    if (!equalSecret(clientId, config.serviceClientId) || !equalSecret(clientSecret, config.serviceClientSecret)) {
      throw new HttpError(401, 'INVALID_SERVICE_CREDENTIALS');
    }
    req.auditSubject = clientId;
    req.recordDecision('allow', 'SERVICE_LOGIN_ALLOWED');
    res.json({
      token_type: 'Bearer', expires_in: 300,
      access_token: issueToken({ sub: clientId, role: 'service', type: 'service' }, config, now()),
    });
  });
  return router;
}
