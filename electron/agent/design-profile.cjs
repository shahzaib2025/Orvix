const additions = { none: true, normal: true, medium: true, max: true };
function resolveDesignProfile(value, legacyMode) {
  if (value !== undefined && value !== null) {
    if (!Object.hasOwn(additions, value)) throw new Error('Unknown design profile. Choose none, normal, medium or max.');
    return value;
  }
  return { fast: 'medium', balanced: 'max', quality: 'max', off: 'normal' }[legacyMode] ?? 'normal';
}
function profileGuidance(value = 'normal') {
  const profile = resolveDesignProfile(value);
  if (profile === 'normal' || profile === 'none') return '';
  return require('./skill-library.cjs').selectedSkill('website_design', profile).instructions;
}
module.exports = { resolveDesignProfile, profileGuidance };
