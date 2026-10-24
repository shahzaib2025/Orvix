const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const registry = require('./skills/registry.json');
const { canonicalTarget } = require('./workspace-manager.cjs');
const { skillAllowed } = require('./skill-policy.cjs');
// Native OpenCode needs the unpacked Markdown files, not an Electron archive path.
function unpackedRoot(directory = __dirname) {
  return path.join(directory.replace(/([\\/])app\.asar(?=[\\/]|$)/i, '$1app.asar.unpacked'), 'skills');
}
function createSkillLibrary(root = unpackedRoot()) {
  const cache = new Map();
  const key = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
  const entries = registry.map(entry => ({ ...entry, path: path.resolve(root, entry.file) }));
  function listSkills(native = false) {
    return entries.map(({ path: filePath, ...entry }) => native ? { ...entry, path: filePath } : entry);
  }
  function readSkill(id) {
    const entry = entries.find(item => item.id === id);
    if (!entry) throw new Error(`Unknown agent skill: ${String(id)}.`);
    try {
      const stat = fs.statSync(entry.path);
      if (!stat.isFile()) throw new Error('Not a regular file');
      if (key(fs.realpathSync(entry.path)) !== key(entry.path)) throw new Error('Managed skill must not be a symbolic link');
      const metadata = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
      let stored = cache.get(id);
      if (!stored || stored.metadata !== metadata) {
        const instructions = fs.readFileSync(entry.path, 'utf8');
        if (!instructions.trim()) throw new Error('Skill file is empty');
        stored = { metadata, instructions, contentHash: crypto.createHash('sha256').update(instructions).digest('hex') };
        cache.set(id, stored);
      }
      return { id, name: entry.name, description: entry.description, file: entry.file, instructions: stored.instructions, contentHash: stored.contentHash };
    } catch (error) {
      cache.delete(id);
      throw new Error(`Agent skill ${id} is missing or unreadable: ${error.message}`);
    }
  }
  function managedTarget(file) {
    const resolved = path.resolve(file);
    let canonical = resolved;
    try { canonical = canonicalTarget(resolved); } catch { /* Protect nonexistent edit targets too. */ }
    const inside = target => key(target) === key(root) || key(target).startsWith(key(root) + path.sep);
    return inside(resolved) || inside(canonical);
  }
  function nativeSkill(file, designProfile, policy) {
    if (typeof file !== 'string') return null;
    const entry = entries.find(item => key(item.path) === key(file));
    if (designProfile && !(policy ? policy.allows(entry) : skillAllowed(entry, designProfile))) return null;
    return entry ? readSkill(entry.id) : null;
  }
  function skillDirectory(folder) {
    return key(folder) === key(root) || entries.some(entry => key(folder) === key(path.dirname(entry.path)));
  }
  return { listSkills, readSkill, nativeSkill, managedTarget, skillDirectory, root };
}
const library = createSkillLibrary();
function selectedSkills({ native = false, designProfile = 'normal', policy, explicitIds = [] } = {}) {
  if (!['none', 'normal', 'medium', 'max'].includes(designProfile)) throw new Error('Unknown design profile.');
  return library.listSkills(native).filter(entry => policy ? policy.allows(entry) : skillAllowed(entry, designProfile, explicitIds));
}
function selectedSkill(id, designProfile = 'normal', policy) {
  const entries = selectedSkills({ designProfile, policy });
  // Preserve the original tool ID as an alias, resolved by the actual task setting.
  const selectedId = id === 'website_design' && designProfile !== 'none' ? entries.find(entry => entry.designProfile)?.id : id;
  if (!entries.some(entry => entry.id === selectedId)) throw new Error(`Skill ${id} is not available for selected design profile ${designProfile}.`);
  return library.readSkill(selectedId);
}
function skillCatalogPrompt({ designProfile = 'normal', specialty = null, native = false, policy, explicitIds = [] } = {}) {
  const none = designProfile === 'none';
  return 'Bundled topic skills (catalog metadata only):\n' + JSON.stringify(selectedSkills({ native, designProfile, policy, explicitIds }))
    + '\nFor every current request and steering instruction, reconsider relevance. Before substantial work, choose and read matching skills; combine skills when useful. If none fits, proceed with core instructions. Reuse successfully read instructions within this task unless the file changes. Report missing/unreadable skills explicitly; never claim loading without a successful complete read. '
    + (native ? 'Read the exact absolute path using the native read tool, without offset/limit so the whole file is returned. Do not register or index the skill directory as a project. Built-in skill discovery is disabled.' : 'Use read_agent_skill with its registered ID; list_agent_skills returns this catalog when needed.')
    + '\nTask settings: ' + JSON.stringify({ designProfile, specialty })
    + (none ? '. None is selected: use your judgment for website design. Do not automatically load website skills, require a storyboard/design brief, compare prior designs or run a design critic. Relevant technical skills explicitly requested or clearly required by the current task may be listed independently of the design profile; for a concrete 3D/WebGL scene, asset, or repair, read threejs before substantial work even under None. Also read gltf_assets only when the task involves sourcing, importing, validating, or optimizing external 3D models or textures. These technical guides do not choose a visual concept, activate a website profile, or enable MAX workflow. Ordinary coding, asset search, previews and functional checks remain available. Earlier profile instructions are inactive. If multiple creative skills were requested, clarify which one to use before loading them.' : '. For website work, use only the website design profile listed for this task; never combine profiles or apply a previous profile. Read relevant technical skills when the task requires them, including threejs for a concrete 3D/WebGL scene, asset, or repair regardless of the design profile. Read gltf_assets only for external 3D asset sourcing, import, validation, or optimization. Technical guidance does not select a creative profile. Reconsider relevance for each request. These settings alone do not make a non-design task website work.')
    + ' Add Three.js only when 3D is explicitly requested or the existing 3d-website option is selected. For a concrete scene or asset task, read threejs; read gltf_assets as well only when external model or texture sourcing, import, validation, or optimization is in scope. These guides provide engineering direction, never a visual template.'
    + (designProfile === 'max' ? ' website_design_max is the creative entrypoint; website_motion_max is the shared technical router. After choosing the direction, read that router and only the matching registered tool skills before substantial implementation: gsap, scrolltrigger, and lenis for a qualifying new full MAX website; gsap_svg for Flip/DrawSVG/MorphSVG; gsap_text for SplitText/ScrambleText/TextPlugin; threejs only for human-opted-in 3D; gltf_assets only for external 3D asset sourcing/import/validation/optimization. Combine only relevant skills. Do not load unused guides or treat them as design templates. Skip motion guidance for static or unrelated work.' : '');
}
function loadedSkillContext(skills, { designProfile } = {}) {
  return skills.length ? '\nSuccessfully read bundled instructions (reconsider relevance for the current request):\n'
    + skills.map(skill => skill.stale
      ? `Previously read skill ${skill.id}; evidence ${skill.evidenceId}. ${skill.reason} Read the current registered skill before applying its instructions.`
      : `Skill ${skill.id}; sha256 ${skill.contentHash}; evidence ${skill.evidenceId}\n${skill.instructions}`).join('\n\n')
      + (designProfile === 'none' ? '\nNone remains selected. Apply explicitly requested skills within the human scope; their instructions do not enable automatic storyboard/design-brief tooling, originality comparisons, construction holds or design reviews. Ordinary previews and functional checks remain available.' : '') : '';
}
function refreshLoadedSkills(skills) {
  const notices = [];
  for (const skill of skills) {
    let reason;
    try { if (library.readSkill(skill.id).contentHash !== skill.contentHash) reason = `Skill ${skill.id} changed since its successful read.`; }
    catch (error) { reason = error.message; }
    if (reason && (!skill.stale || skill.reason !== reason)) {
      skill.stale = true; skill.reason = reason; notices.push(reason + ' Read the current skill before using it.');
    }
  }
  return notices;
}
function completeNativeRead(skill, output) {
  const clean = text => String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/^[ \t]*\d+(?:\| ?|: ?)/gm, '')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\uFFFD|[\x80-\xFF]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
  const normalizedOutput = clean(output);
  const normalizedInstructions = clean(skill.instructions);
  return normalizedOutput.includes(normalizedInstructions);
}
module.exports = { ...library, createSkillLibrary, unpackedRoot, selectedSkills, selectedSkill, skillCatalogPrompt, loadedSkillContext, refreshLoadedSkills, completeNativeRead };
