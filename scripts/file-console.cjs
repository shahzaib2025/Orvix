const fs = require('node:fs');
const { Console } = require('node:console');

function installFileConsole(file) {
  const log = fs.createWriteStream(file, { flags: 'a' });
  global.console = new Console({ stdout: log, stderr: log });
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', error => {
      if (error.code !== 'EPIPE' && error.code !== 'ERR_STREAM_DESTROYED') throw error;
    });
  }
  return log;
}
module.exports = { installFileConsole };
