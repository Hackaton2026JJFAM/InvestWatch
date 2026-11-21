// Socket.io: powiadomienia w czasie rzeczywistym (nowe materiały, alerty, statusy zadań).
// Handshake przyjmowany tylko z tego samego hosta (lub z ALLOWED_ORIGINS) – blokada obcych stron.
import { Server } from 'socket.io';
import { config } from './config.js';

let io = null;

export function originAllowed(origin, host) {
  if (!origin) return true; // klienci spoza przeglądarki (testy, curl) nie wysyłają Origin
  try {
    const o = new URL(origin);
    if (config.allowedOrigins.includes(o.origin)) return true;
    return Boolean(host) && o.host === host;
  } catch {
    return false;
  }
}

export function attach(httpServer) {
  io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: false },
    allowRequest: (req, callback) => {
      const host = req.headers['x-forwarded-host'] ?? req.headers.host;
      callback(null, originAllowed(req.headers.origin, host));
    },
  });
  return io;
}

export function emit(event, payload) {
  if (io) io.emit(event, payload);
}
