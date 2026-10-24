const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm' };
function createStaticPreview(directory) {
  const root = fs.realpathSync(directory);
  return http.createServer((request, response) => {
    const fail = code => { response.writeHead(code); response.end(); };
    if (!['GET', 'HEAD'].includes(request.method)) return fail(405);
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const segments = pathname.split(/[\\/]/);
      if (segments.some(segment => segment.startsWith('.') || /[\0:]/.test(segment))) return fail(403);
      let file = path.resolve(root, '.' + pathname);
      if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      const real = fs.realpathSync(file), relative = path.relative(root, real);
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return fail(403);
      const mime = types[path.extname(real).toLowerCase()];
      if (!mime || /(?:^|[-_.])(?:credentials?|secrets?|tokens?)(?:[-_.]|$)/i.test(path.basename(real))) return fail(403);
      const stat = fs.statSync(real);
      if (!stat.isFile()) return fail(404);
      response.writeHead(200, { 'Content-Type': mime, 'Content-Length': stat.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      if (request.method === 'HEAD') return response.end();
      fs.createReadStream(real).on('error', () => response.destroy()).pipe(response);
    } catch { fail(404); }
  });
}
if (require.main === module) {
  const server = createStaticPreview(process.argv[2] || process.cwd());
  server.listen(0, '127.0.0.1', () => process.stdout.write(`PREVIEW_URL=http://127.0.0.1:${server.address().port}/\n`));
  process.once('SIGTERM', () => server.close());
}
module.exports = { createStaticPreview };
