import http from 'node:http';
import worker from '../build/worker.js';
import { requestHandler } from './http-adapter.js';
import { createDeviceSessions } from './device-sessions.js';
const env = { ...process.env };
const devices = env.DEVICE_SESSION_FILE ? await createDeviceSessions({ file: env.DEVICE_SESSION_FILE, owner: env.POSITIONS_EMAIL?.trim().toLowerCase() }) : null;
const handle = (request, env) => worker.fetch(request, env);
const server = http.createServer(requestHandler((request, env) => devices ? devices(request, env, handle) : handle(request, env), env));
server.requestTimeout = 120000;
server.headersTimeout = 15000;
server.maxHeadersCount = 50;
server.listen(8787, '0.0.0.0', () => console.log('Rate Monitor listening on 8787'));
function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
