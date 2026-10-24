const http = require('node:http');
const { createStaticPreview } = require('../electron/agent/static-preview.cjs');
const root = process.argv[2];
if (!root) throw Error('Supply the comparison folder.');
const files = createStaticPreview(root);
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/') { response.writeHead(302, { Location: '/Comparison/' }); response.end(); return; }
  if (!['Default', 'Medium', 'MAX', 'Comparison'].includes(pathname.split('/')[1])) { response.writeHead(404); response.end(); return; }
  files.emit('request', request, response);
});
server.listen(0, '127.0.0.1', () => process.stdout.write(`PREVIEW_URL=http://127.0.0.1:${server.address().port}/\n`));
process.once('SIGTERM', () => server.close());
