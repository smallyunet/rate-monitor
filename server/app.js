import http from 'node:http';
import worker from '../build/worker.js';
import { requestHandler } from './http-adapter.js';
const server = http.createServer(requestHandler((request, env) => worker.fetch(request, env), process.env));
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
