// Socket.io: powiadomienia w czasie rzeczywistym (nowe materiały, alerty, statusy zadań).
import { Server } from 'socket.io';

let io = null;

export function attach(httpServer) {
  io = new Server(httpServer, { path: '/socket.io', cors: { origin: false } });
  return io;
}

export function emit(event, payload) {
  if (io) io.emit(event, payload);
}
