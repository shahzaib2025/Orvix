const path = require('node:path');

const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'build', 'release', 'coverage', 'target', '.next', '.cache']);
const credentialNames = new Set(['id_rsa', 'id_ed25519', 'id_ecdsa', 'known_hosts', 'secrets.json', 'secrets.yaml', 'secrets.yml']);
const credentialDirectories = new Set(['.ssh', '.aws', '.gnupg', '.config']);

function isSensitiveFile(file) {
  const name = path.basename(file).toLowerCase();
  return /^\.env(?:\.|$)/.test(name) || credentialNames.has(name) || /\.(?:pem|pfx|p12|keystore)$/i.test(name);
}

function isHiddenPath(file) {
  return path.resolve(file).split(path.sep).some(part =>
    isSensitiveFile(part) || credentialDirectories.has(part.toLowerCase()) || ignoredDirectories.has(part.toLowerCase()));
}

module.exports = { ignoredDirectories, credentialDirectories, isSensitiveFile, isHiddenPath };
