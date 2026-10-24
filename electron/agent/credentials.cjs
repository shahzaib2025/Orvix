const fs = require('node:fs');
const path = require('node:path');
const { createApiKeyStore, providerEnvKeys } = require('./api-key-store.cjs');
const { NARA_BASE_URL } = require('./provider-registry.cjs');

const envKeys = { zen: 'ORVIX_OPENCODE_ZEN_KEY', go: 'ORVIX_OPENCODE_GO_KEY', kilo: 'ORVIX_KILO_KEY' };
const providerTiers = Object.keys(providerEnvKeys);
const keyTiers = [...Object.keys(envKeys), ...providerTiers];

function readEnvValue(contents, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = contents.split(/\r?\n/).findLast(value => new RegExp(`^\\s*(?:export\\s+)?${escaped}\\s*=`).test(value));
  if (!line) return '';
  const value = line.slice(line.indexOf('=') + 1).trim();
  if (value.startsWith('"') && value.endsWith('"')) { try { return JSON.parse(value); } catch { return value.slice(1, -1); } }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value.replace(/\s+#.*$/, '').trim();
}

function writeEnvValue(file, name, value) {
  let contents = '';
  try { contents = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const lines = contents ? contents.split(/\r?\n/) : [];
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matcher = new RegExp(`^\\s*(?:export\\s+)?${escaped}\\s*=`);
  const valueLines = value ? [`${name}=${JSON.stringify(value)}`] : [];
  const first = lines.findIndex(line => matcher.test(line));
  const kept = lines.filter(line => !matcher.test(line));
  if (valueLines.length) kept.splice(first < 0 ? kept.length : Math.min(first, kept.length), 0, ...valueLines);
  const output = kept.join('\n').replace(/\n*$/, '\n');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, output, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function createCredentials(app, safeStorage, options = {}) {
  const environment = options.environment ?? process.env;
  const target = path.join(app.getPath('userData'), 'opencode-credentials.json');
  const envFile = options.envFilePath ?? path.join(app.getAppPath?.() ?? process.cwd(), '.env');
  const session = Object.fromEntries(keyTiers.map(tier => [tier, '']));
  let stored = {};
  try { stored = JSON.parse(fs.readFileSync(target, 'utf8')); } catch { /* no saved key */ }
  function legacyKey(tier) {
    if (!safeStorage.isEncryptionAvailable() || typeof stored[tier] !== 'string') return '';
    try { return safeStorage.decryptString(Buffer.from(stored[tier], 'base64')); } catch { return ''; }
  }
  const apiKeys = createApiKeyStore({ readFile: readEnvFile, readValue: readEnvValue,
    writeValue: (name, value) => writeEnvValue(envFile, name, value), legacyKey, environment,
    removeLegacy: tier => { if (stored[tier]) { delete stored[tier]; fs.writeFileSync(target, JSON.stringify(stored), { mode: 0o600 }); } },
  });
  function getKey(tier) {
    if (!keyTiers.includes(tier)) return '';
    if (providerEnvKeys[tier]) return apiKeys.entries(tier).find(entry => entry.enabled)?.key ?? '';
    const envName = envKeys[tier] ?? providerEnvKeys[tier];
    const environmentKey = envName ? (environment[envName] || readEnvValue(readEnvFile(), envName)).trim() : '';
    if (environmentKey) return environmentKey;
    if (session[tier]) return session[tier];
    if (!safeStorage.isEncryptionAvailable() || typeof stored[tier] !== 'string') return '';
    try { return safeStorage.decryptString(Buffer.from(stored[tier], 'base64')); } catch { return ''; }
  }
  function readEnvFile() {
    try { return fs.readFileSync(envFile, 'utf8').replace(/^\uFEFF/, ''); }
    catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
  }
  function status() {
    const result = { canPersist: safeStorage.isEncryptionAvailable(), naraBaseUrl: NARA_BASE_URL };
    for (const tier of keyTiers) {
      const envName = envKeys[tier] ?? providerEnvKeys[tier];
      const keys = providerEnvKeys[tier] ? apiKeys.snapshot(tier) : undefined;
      result[tier] = { configured: Boolean(getKey(tier)), fromEnvironment: Boolean(envName && environment[envName]?.trim()), fromFile: keys?.some(key => key.source === 'file') ?? false, ...(keys ? { keys } : {}) };
    }
    return result;
  }
  function setKey(tier, key) {
    if (!keyTiers.includes(tier) || typeof key !== 'string' || key.length > 1024) throw new Error('Invalid provider key.');
    session[tier] = key.trim();
    if (providerEnvKeys[tier]) {
      if (!key.trim()) throw new Error('Choose an individual API key to remove.');
      apiKeys.change(tier, { operation: 'add', key });
      return status();
    }
    if (safeStorage.isEncryptionAvailable()) {
      if (session[tier]) stored[tier] = safeStorage.encryptString(session[tier]).toString('base64');
      else delete stored[tier];
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(stored), { mode: 0o600 });
    } else if (!session[tier] && stored[tier]) {
      delete stored[tier];
      fs.writeFileSync(target, JSON.stringify(stored), { mode: 0o600 });
    }
    return status();
  }
  function getBaseUrl(tier) {
    return tier === 'nara' ? NARA_BASE_URL : '';
  }
  function changeApiKey(tier, input) { apiKeys.change(tier, input); return status(); }
  return { getKey, getBaseUrl, status, setKey, apiKeys, changeApiKey };
}

module.exports = { createCredentials, readEnvValue, writeEnvValue, providerEnvKeys };
