const { randomInt } = require('node:crypto');

// Windows can allocate a low blocked port for listen(0). Keep local HTTP
// services outside Fetch's reserved-port range without changing browser policy.
async function listenBrowserLoopback(server, choosePort = () => randomInt(49152, 65536)) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = choosePort();
    if (!Number.isInteger(port) || port < 49152 || port > 65535) throw Error('Choose a dynamic-range loopback port.');
    try {
      await new Promise((resolve, reject) => {
        const cleanup = () => { server.removeListener('error', failed); server.removeListener('listening', ready); };
        const failed = error => { cleanup(); reject(error); };
        const ready = () => { cleanup(); resolve(); };
        server.once('error', failed); server.once('listening', ready);
        server.listen(port, '127.0.0.1');
      });
      return;
    } catch (error) { if (error.code !== 'EADDRINUSE' || attempt === 19) throw error; }
  }
}
module.exports = { listenBrowserLoopback };
