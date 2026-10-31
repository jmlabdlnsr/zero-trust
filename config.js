import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function readEnvironment() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  return loadConfig(process.env);
}

export function loadConfig(env = process.env) {
  const secret = key => {
    const value = env[key];
    if (!value || value.length < 32 || value.startsWith('GENERATE_')) {
      throw new Error(`${key} harus minimal 32 karakter. Jalankan npm run setup.`);
    }
    return value;
  };
  const integer = (key, fallback, min, max) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key} tidak valid.`);
    return value;
  };
  const config = {
    host: env.HOST || '127.0.0.1',
    gatewayPort: integer('GATEWAY_PORT', 3000, 1, 65535),
    nilaiPort: integer('NILAI_PORT', 3001, 1, 65535),
    transkripPort: integer('TRANSKRIP_PORT', 3002, 1, 65535),
    dbPath: resolve(env.DB_PATH || './data/zero-trust.sqlite'),
    jwtSecret: secret('JWT_SECRET'), gatewaySecret: secret('GATEWAY_SECRET'),
    serviceClientId: env.SERVICE_CLIENT_ID || 'service-nilai',
    serviceClientSecret: secret('SERVICE_CLIENT_SECRET'),
    accessStart: env.ACCESS_START || '07:00', accessEnd: env.ACCESS_END || '21:00',
    timezone: env.ACCESS_TIMEZONE || 'Asia/Jakarta',
    timeoutMs: integer('REQUEST_TIMEOUT_MS', 5000, 100, 60000),
    issuer: 'zero-trust-gateway', audience: 'sistem-nilai',
  };
  if (new Set([config.gatewayPort, config.nilaiPort, config.transkripPort]).size !== 3) {
    throw new Error('Ketiga port harus berbeda.');
  }
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!time.test(config.accessStart)
    || !(time.test(config.accessEnd) || config.accessEnd === '24:00')
    || config.accessStart === config.accessEnd) {
    throw new Error('Jam akses tidak valid. Gunakan HH:mm; untuk 24 jam gunakan 00:00-24:00.');
  }
  new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone }).format(new Date());
  config.gatewayUrl = `http://127.0.0.1:${config.gatewayPort}`;
  config.nilaiUrl = `http://127.0.0.1:${config.nilaiPort}`;
  config.transkripUrl = `http://127.0.0.1:${config.transkripPort}`;
  return config;
}
