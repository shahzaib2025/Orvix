function normalizeAccessMode(mode, version) {
  return version === 2 ? mode : mode === 'Full access' ? 'Controlled' : mode;
}

function automaticChoice(mode, kind, aborted = false) {
  if (aborted) return false;
  if (mode === 'Full access') return kind === 'workspace' ? true : 'host';
  if (mode === 'Plan') return kind === 'workspace';
  return null;
}

module.exports = { automaticChoice, normalizeAccessMode };
