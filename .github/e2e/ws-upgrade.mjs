// WebSocket upgrade check for the deploy-e2e workflow (issue #150).
//
// Opens GET /api/terminal/ws through the stack's inner nginx with a plain
// HTTP/1.1 Upgrade request (no WebSocket client library, no credentials) and
// asserts the two things the route exists to guarantee:
//
//   1. the handshake answers `101 Switching Protocols`, so nginx forwarded the
//      Upgrade and Connection headers (the exact-match location in
//      infra/nginx/app.d/locations/terminal-ws.conf), and
//   2. the API's gateway answered on that socket: an unauthenticated client is
//      told `auth_fail` (immediately for a bad message, or after the gateway's
//      5 second authentication timeout), which only the gateway sends.
//
// Usage: node ws-upgrade.mjs <host> <port>
import { createConnection } from 'node:net';

const [host = '127.0.0.1', port = '8323'] = process.argv.slice(2);
const TIMEOUT_MS = 20_000;

const socket = createConnection({ host, port: Number(port) });
let received = Buffer.alloc(0);

const fail = (message) => {
  console.error(`ws-upgrade: ${message}`);
  console.error(received.toString('utf8').slice(0, 600));
  socket.destroy();
  process.exit(1);
};
const timer = setTimeout(() => fail(`no auth_fail within ${TIMEOUT_MS} ms`), TIMEOUT_MS);

socket.on('connect', () => {
  socket.write(
    [
      'GET /api/terminal/ws HTTP/1.1',
      `Host: ${host}:${port}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version: 13',
      '',
      '',
    ].join('\r\n'),
  );
});

socket.on('data', (chunk) => {
  received = Buffer.concat([received, chunk]);
  const text = received.toString('utf8');
  if (/^HTTP\/1\.1 (?!101)/.test(text)) return fail('the handshake was not answered with 101');
  if (text.startsWith('HTTP/1.1 101') && text.includes('auth_fail')) {
    clearTimeout(timer);
    console.log('ws-upgrade: 101 Switching Protocols, then auth_fail from the gateway');
    socket.destroy();
    process.exit(0);
  }
});
socket.on('error', (error) => fail(error.message));
socket.on('close', () => fail('the socket closed before auth_fail arrived'));
