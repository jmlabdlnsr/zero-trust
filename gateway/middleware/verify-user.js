import { bearerToken, verifyToken, HttpError } from '../../shared/index.js';

// Verifikasi JWT sebelum policy gateway dijalankan.
export function verifyUser({ config, now }) {
  return (req, res, next) => {
    try {
      req.accessToken = bearerToken(req.get('Authorization'));
      req.claims = verifyToken(req.accessToken, config, now());
    } catch {
      return next(new HttpError(401, 'INVALID_TOKEN', 'Token tidak valid atau kedaluwarsa.'));
    }
    req.auditSubject = req.claims.sub;
    next();
  };
}
