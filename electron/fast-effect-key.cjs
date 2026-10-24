// The same reviewed action has the same identity regardless of object key order.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
  return value;
}
function effectKey(kind, input = {}) {
  const { requestId, revision, stepId, controlIdentity, ...effect } = input;
  return JSON.stringify(canonical({ kind, input: effect }));
}
module.exports = { effectKey };
