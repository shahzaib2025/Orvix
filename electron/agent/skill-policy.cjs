const registry = require('./skills/registry.json');
const { isContinuationRequest } = require('./task-continuation.cjs');

const websiteIds = new Set(registry.filter(entry => entry.designProfile || entry.forDesignProfile || entry.websiteGuidance).map(entry => entry.id));
const entryById = new Map(registry.map(entry => [entry.id, entry]));
const implementationAction = /\b(?:build|create|make|implement|add|repair|fix|improve|update|change|modify|render|model|animate|integrate|inspect|examine|review|assess|evaluate|check|chk|open|audit|debug|use|load|read|follow|finish|continue|work\s+on|test|verify)\b/i;
const threeDimensional = /\b(?:3d|three\s*dimensional|threejs|webgl|webgpu|gltf|glb)\b/i;
const external3dAssetWork = /\b(?:gltf|glb|3d\s+assets?|3d\s+models?|models?|assets?|import(?:ed)?|source|find|search|export|optimi[sz]e|compress(?:ion|ed)?|texture|license|provenance|convert)\b/i;

function cleanHumanRequest(request) {
  return String(request ?? '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]*)`/g, (_, id) => {
      const normalized = id.replace(/\bthree\s*\.?\s*js\b/gi, 'threejs');
      return websiteIds.has(normalized) ? normalized : '';
    })
    .replace(/"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’|(?<!\w)'[^'\n]*'(?!\w)/g, '')
    .replace(/^\s*>.*$/gm, '')
    .replace(/\bthree\s*\.\s*js\b/gi, 'threejs')
    .replace(/\bthree\s+js\b/gi, 'threejs');
}

function negatesThreeJs(request) {
  return cleanHumanRequest(request).split(/[.!?;\n]|\b(?:but|instead)\b/i).some(clause =>
    /\b(?:don['’]?t|do\s+not|never|without|avoid|disable|skip|no)\b.{0,60}\b(?:threejs|3d|webgl|webgpu|three\s+dimensional)\b/i.test(clause)
    || /\b(?:threejs|3d|webgl|webgpu)\b.{0,35}\b(?:not|instead\s+of)\b/i.test(clause));
}

function negatesExternal3dAssets(request) {
  return cleanHumanRequest(request).split(/[.!?;\n]|\b(?:but|instead)\b/i).some(clause =>
    /\b(?:don['’]?t|do\s+not|never|without|avoid|disable|skip|no)\b.{0,55}\b(?:external|third.party|downloaded|sourced|imported|gltf|glb|model|texture|asset)\b/i.test(clause)
    || /\b(?:gltf|glb|external\s+models?|external\s+assets?)\b.{0,35}\b(?:not|instead\s+of)\b/i.test(clause));
}

function taskTechnicalSkills(request) {
  const text = cleanHumanRequest(request);
  if (negatesThreeJs(request) || !threeDimensional.test(text)) return [];
  const errorOrInspection = /\b(?:bug|error|failure|broken|issue|problem|not\s+rendering|blank\s+canvas|crash|inspect|examine|review|assess|evaluate|check|chk|audit|debug|test|verify)\b/i;
  if (!implementationAction.test(text) && !errorOrInspection.test(text)) return [];
  const selected = ['threejs'];
  if (external3dAssetWork.test(text) && !negatesExternal3dAssets(request)) selected.push('gltf_assets');
  return selected;
}

function humanSkillRequests(request) {
  // Only trusted human text reaches this parser. Quoted/reference text cannot grant permission.
  const text = cleanHumanRequest(request);
  const requested = new Set();
  const directlyRequested = new Set();
  let revoke = false;
  for (const clause of text.split(/[.!?;\n]|\b(?:but|instead)\b/i)) {
    const negative = /\b(?:don['’]?t|do\s+not|never|stop|without|avoid|disable)\b/i.test(clause);
    const names = [];
    for (const entry of registry.filter(item => websiteIds.has(item.id))) {
      const escaped = entry.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const namedId = new RegExp('\\b' + escaped + '\\b', 'i').test(clause)
        && (entry.id.startsWith('website_') || /\bskills?\b/i.test(clause) || new RegExp('\\$' + escaped + '\\b', 'i').test(clause));
      const namedProfile = entry.designProfile && new RegExp('\\b(?:' + (entry.designProfile === 'normal' ? 'default|normal' : entry.designProfile) + ')\\s+(?:website\\s+)?(?:design\\s+)?skill\\b|\\b(?:website\\s+)?design\\s+(?:' + entry.designProfile + ')\\s+skill\\b', 'i').test(clause);
      const namedGltfGuide = entry.id === 'gltf_assets' && /\b(?:gltf|glb|3d\s+assets?|3d\s+models?)\b.{0,35}\b(?:asset\s+)?(?:sourcing\s+)?(?:skill|guide|pipeline)\b|\b(?:skill|guide|pipeline)\b.{0,35}\b(?:gltf|glb|3d\s+assets?)\b/i.test(clause);
      if (namedId || namedProfile || namedGltfGuide) names.push(entry.id);
    }
    if (negative && (names.length || /\bskills?\b/i.test(clause))) {
      revoke = true;
      if (!names.length) { requested.clear(); directlyRequested.clear(); }
      for (const id of names) {
        requested.delete(id); directlyRequested.delete(id);
        if (id === 'website_design_max') { requested.delete('website_motion_max'); directlyRequested.delete('website_motion_max'); }
      }
      continue;
    }
    if (/\b(?:how to|explain|example|quoted|whether|what happens)\b/i.test(clause)) continue;
    if (/\b(?:use|load|read|apply|enable|follow)\b/i.test(clause)) for (const id of names) { requested.add(id); directlyRequested.add(id); }
  }
  // Several creative profiles would reintroduce conflicting instructions. Require clarification.
  const creative = [...requested].filter(id => entryById.get(id)?.designProfile);
  if (creative.length > 1) return { ids: [], directIds: [], revoke: true, conflict: true };
  if (requested.has('website_design_max')) for (const entry of registry.filter(item => item.forDesignProfile === 'max')) requested.add(entry.id);
  return { ids: [...requested], directIds: [...directlyRequested], revoke, conflict: false };
}

function skillAllowed(entry, profile = 'normal', explicitIds = []) {
  if (!entry) return false;
  if (entry.websiteGuidance) return profile !== 'none' || explicitIds.includes(entry.id);
  // A task-selected technical guide is eligible across design profiles; it cannot select a creative profile.
  if (!entry.designProfile && explicitIds.includes(entry.id)) return true;
  if (!entry.designProfile && !entry.forDesignProfile) return true;
  if (profile === 'none') {
    const explicitMaxMotion = explicitIds.includes('website_design_max') || explicitIds.includes('website_motion_max');
    return explicitIds.includes(entry.id) || (explicitMaxMotion && entry.forDesignProfile === 'max');
  }
  return (!entry.designProfile || entry.designProfile === profile) && (!entry.forDesignProfile || entry.forDesignProfile === profile);
}

function createSkillPolicy(profile, request, saved, { resume = false } = {}) {
  const followingUp = isContinuationRequest(request) || /^(?:please\s+)?(?:fix|improve|adjust|change|test|check|finish|update)\s+(?:it|this|that|the\s+(?:same\s+)?(?:website|page|hero|form|navigation|section))\b/i.test(String(request ?? '').trim());
  const continuing = followingUp || resume;
  let ids = continuing ? (saved?.explicitIds ?? []).filter(id => entryById.has(id) && (profile === 'none' || !entryById.get(id)?.designProfile)) : [];
  let conflict = false;
  function update(text, isSteering = true) {
    const parsed = humanSkillRequests(text);
    const inferredTechnical = taskTechnicalSkills(text);
    if (parsed.directIds.includes('gltf_assets') && !inferredTechnical.includes('threejs')) inferredTechnical.push('threejs');
    const requestedTechnical = [...new Set([
      ...parsed.directIds.filter(id => !entryById.get(id)?.designProfile),
      ...inferredTechnical,
    ])];
    const newTask = !isSteering || /\b(?:new|another|different)\s+(?:full\s+)?website\b/i.test(String(text));
    const deniedThreeJs = negatesThreeJs(text);

    if (profile !== 'none') {
      if (newTask) ids = requestedTechnical;
      else if (deniedThreeJs || (parsed.revoke && requestedTechnical.length === 0)) ids = [];
      else ids = [...new Set([...ids.filter(id => !entryById.get(id)?.designProfile), ...requestedTechnical])];
      conflict = false;
      return;
    }

    const requested = [...new Set([...parsed.ids, ...inferredTechnical])];
    if (newTask || parsed.revoke || deniedThreeJs || requested.length || parsed.conflict) {
      ids = deniedThreeJs ? requested.filter(id => id !== 'threejs') : requested;
    }
    conflict = parsed.conflict;
  }
  update(request, true);
  return { profile, update, allows: entry => skillAllowed(entry, profile, ids),
    snapshot: () => ({ explicitIds: [...ids], conflict }) };
}

module.exports = { createSkillPolicy, humanSkillRequests, skillAllowed, taskTechnicalSkills };
