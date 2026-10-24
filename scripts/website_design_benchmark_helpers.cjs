const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { structuralSignature, structureSimilarity } = require('../electron/agent/design-composition.cjs');

const profiles = new Set(['none', 'normal', 'medium', 'max']);
const modes = new Set(['fast', 'balanced']);
const cases = new Set(['luxury', 'saas', 'portfolio']);

function option(args, name) {
  const prefix = `--${name}=`;
  const matches = args.filter(value => value.startsWith(prefix));
  if (matches.length > 1) throw new Error(`Use ${prefix} only once.`);
  return matches.length ? matches[0].slice(prefix.length) : undefined;
}

function parseBenchmarkOptions(args) {
  const profile = option(args, 'profile');
  const profilesValue = option(args, 'profiles');
  if (profile !== undefined && profilesValue !== undefined) throw new Error('Use either --profile or --profiles, not both.');
  const selectedProfiles = profilesValue === undefined ? [profile ?? 'normal'] : profilesValue.split(',').map(item => item.trim());
  if (!selectedProfiles.length || selectedProfiles.some(item => !profiles.has(item)) || new Set(selectedProfiles).size !== selectedProfiles.length) {
    throw new Error('Profiles must be unique values from none, normal, medium and max.');
  }
  const caseId = option(args, 'case');
  if (caseId !== undefined && !cases.has(caseId)) throw new Error(`Unknown benchmark case: ${caseId}.`);
  const mode = option(args, 'mode');
  if (mode !== undefined && !modes.has(mode)) throw new Error('Mode must be fast or balanced.');
  const repeatText = option(args, 'repeats') ?? '1';
  if (!/^\d+$/.test(repeatText) || Number(repeatText) < 1 || Number(repeatText) > 5) throw new Error('Repeats must be an integer from 1 to 5.');
  const history = option(args, 'history') ?? 'shared';
  if (!['shared','isolated'].includes(history)) throw new Error('History must be shared or isolated.');
  const priorRoot = option(args,'prior-root');
  if(priorRoot && history==='isolated')throw new Error('Prior observations require shared history.');
  return {
    model: option(args, 'model'), variant: option(args, 'variant'), caseId, mode,
    profiles: selectedProfiles, repeats: Number(repeatText), history, priorRoot,
  };
}

function runId(caseId, profile, mode, repeat, options) {
  if (options.profiles.length === 1 && options.profiles[0] === 'normal' && options.repeats === 1) return `${caseId}-${mode}`;
  return `${caseId}-${profile}-${mode}-r${repeat}`;
}

function benchmarkPrompt(item) {
  return `${item.brief}\n\nBuild the complete website in the approved project directory. Start from the empty page; invent an original visual direction and composition from this brief. Use plain HTML/CSS/JavaScript; preserve package.json and server.cjs, and use the provided dev command "node server.cjs" for the local preview. Additional local assets and style/script files are allowed. Use versioned CDN scripts if the selected profile requires client-side libraries; do not install packages or modify any other project. Keep the page content-led and purposeful: do not add filler or repeat the same section composition to meet a length target. Fully implement the required states. Both 1440px desktop and 390px mobile must work, with legible type, no horizontal overflow, accessible keyboard controls and reduced-motion support.\n\nRequired interaction contract: ${item.contract}\n\nUse preview_website on desktop and mobile, and execute this exact workflow: ${JSON.stringify(item.workflow)}. Also inspect the full page before delivery. Fix observed layout and functional failures. Report only observed results. This is a self-contained local demo, so no clarification is required.`;
}

function sourceEvidence(project) {
  const contents = [], sourceHashes = {};
  let totalBytes = 0;
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ['.git', 'node_modules', 'dist', 'build'].includes(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && /\.(?:html?|[cm]?js|css)$/i.test(entry.name)) {
        const stat = fs.statSync(file);
        if (stat.size <= 2_000_000 && totalBytes + stat.size <= 10_000_000) {
          const content = fs.readFileSync(file, 'utf8'); contents.push(content);
          totalBytes += stat.size;
          sourceHashes[path.relative(project, file).split(path.sep).join('/')] = crypto.createHash('sha256').update(content).digest('hex');
        }
      }
    }
  };
  visit(project);
  const source = contents.join('\n');
  return {
    sourceFileCount: contents.length, sourceHashes, inspectedSourceBytes: totalBytes,
    declaredSections: [...source.matchAll(/<section\b/gi)].length,
    gsapCalls: /\bgsap\.(?:to|from|fromTo|timeline|set|registerPlugin)\s*\(/i.test(source),
    scrollTriggerUse: /\bScrollTrigger(?:\.create)?\b|\bscrollTrigger\s*:/i.test(source),
    lenisInstance: /\bnew\s+Lenis\s*\(/i.test(source),
  };
}

function profileChecks(profile, evidence) {
  if (profile !== 'max') return [];
  return [
    { id: 'nine-sections', expected: '9+ declared section elements', observed: evidence.declaredSections, passed: evidence.declaredSections >= 9 },
    { id: 'gsap', expected: 'GSAP animation API call', observed: evidence.gsapCalls, passed: evidence.gsapCalls },
    { id: 'scrolltrigger', expected: 'ScrollTrigger reference', observed: evidence.scrollTriggerUse, passed: evidence.scrollTriggerUse },
    { id: 'lenis', expected: 'Lenis initialization', observed: evidence.lenisInstance, passed: evidence.lenisInstance },
  ];
}

function reviewOutcomeAccepted(profile, status) {
  return profile === 'none'
    ? status === 'not_needed'
    : ['approved', 'reinspected', 'self_inspected'].includes(status);
}

function compositionSignature(view) {
  const observed = structuralSignature(view);
  if (observed) return observed;
  const metrics = view?.metrics;
  if (!metrics || !Array.isArray(metrics.designSignals)) return null;
  const width = Math.max(1, Number(metrics.viewportWidth) || 1);
  const height = Math.max(1, Number(metrics.documentHeight) || 1);
  const features = metrics.designSignals.filter(signal => ['HEADER', 'NAV', 'MAIN', 'SECTION', 'H1', 'H2', 'BUTTON'].includes(signal.tag)).map(signal => ({
    tag: signal.tag,
    x: Math.round((signal.x / width) * 20) / 20,
    y: Math.round((signal.y / height) * 20) / 20,
    width: Math.round((signal.width / width) * 20) / 20,
    height: Math.round((signal.height / height) * 20) / 20,
  }));
  if (!features.length) return null;
  const value = JSON.stringify(features);
  return { hash: crypto.createHash('sha256').update(value).digest('hex'), features };
}

function signatureSimilarity(left, right) {
  if (left?.version === 2 && right?.version === 2) return structureSimilarity(left,right);
  // Older reports remain comparable without letting cosmetic changes hide
  // matching geometry. No semantic claim is made for legacy signatures.
  const key = feature => JSON.stringify(Object.fromEntries(['tag','x','y','width','height'].map(name=>[name,feature[name]])));
  const a = new Set((left?.features ?? []).map(key));
  const b = new Set((right?.features ?? []).map(key));
  if (!a.size || !b.size) return null;
  let intersection = 0;
  for (const feature of a) if (b.has(feature)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

module.exports = { parseBenchmarkOptions, runId, benchmarkPrompt, sourceEvidence, profileChecks, reviewOutcomeAccepted, compositionSignature, signatureSimilarity };
