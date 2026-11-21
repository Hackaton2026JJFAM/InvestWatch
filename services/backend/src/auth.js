// Rola administratora dla operacji konfiguracyjnych (próg, źródła, próbki, usuwanie).
// Hasło: ADMIN_PASSWORD. Sesja: podpisane HMAC ciasteczko HttpOnly, SameSite=Strict, 8 h.
// Bez ADMIN_PASSWORD operacje administracyjne są wyłączone (403) – bezpieczny domyślny stan.
import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { config } from './config.js';
import { log } from './log.js';
import { parse } from './validate.js';

const COOKIE = 'iw_admin';
const TTL_MS = 8 * 60 * 60 * 1000;
const secret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const hmac = (value) => crypto.createHmac('sha256', secret).update(value).digest('base64url');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((p) => p.trim().split('=')).filter(([k, v]) => k && v).map(([k, v]) => [k, decodeURIComponent(v)]));
}

export function isAdmin(cookieHeader) {
  const token = parseCookies(cookieHeader)[COOKIE];
  if (!token || !config.adminPassword) return false;
  const [exp, sig] = token.split('.');
  return Number(exp) > Date.now() && safeEqual(sig, hmac(exp));
}

export function requireAdmin(req, res, next) {
  if (!config.adminPassword) return res.status(403).json({ error: 'Operacje administracyjne są wyłączone – ustaw ADMIN_PASSWORD', auth: 'disabled' });
  if (isAdmin(req.headers.cookie)) return next();
  res.status(401).json({ error: 'Wymagane logowanie administratora', auth: 'admin' });
}

// Prosty limit prób logowania: 10 na 5 minut na adres IP.
const attempts = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) ?? []).filter((t) => now - t < 5 * 60 * 1000);
  attempts.set(ip, list);
  return list.length >= 10;
}

export const authRouter = Router();

authRouter.get('/auth/me', (req, res) => {
  res.json({ admin: isAdmin(req.headers.cookie), enabled: Boolean(config.adminPassword) });
});

authRouter.post('/auth/login', (req, res) => {
  const { password } = parse(z.object({ password: z.string().min(1).max(200) }), req.body);
  if (!config.adminPassword) return res.status(403).json({ error: 'Logowanie wyłączone – ustaw ADMIN_PASSWORD', auth: 'disabled' });
  if (tooMany(req.ip)) return res.status(429).json({ error: 'Zbyt wiele prób logowania – spróbuj za kilka minut' });
  if (!safeEqual(password, config.adminPassword)) {
    attempts.get(req.ip).push(Date.now());
    log.warn('admin login failed', { ip: req.ip });
    return res.status(401).json({ error: 'Nieprawidłowe hasło', auth: 'admin' });
  }
  const exp = String(Date.now() + TTL_MS);
  res.cookie(COOKIE, `${exp}.${hmac(exp)}`, { httpOnly: true, sameSite: 'strict', secure: config.secureCookies, maxAge: TTL_MS, path: '/' });
  res.json({ admin: true });
});

authRouter.post('/auth/logout', (_req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ admin: false });
});
