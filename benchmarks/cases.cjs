const path = require('node:path');

const cases = [
  {
    name: 'Focused bug fix',
    files: { 'project/package.json': '{"name":"orvix-benchmark-a","private":true}',
      'project/math.js': '// Keep this comment.\nexport function add(a, b) {\n  return a - b;\n}\n' },
    prompt(root) { return `Fix the add function in ${path.join(root, 'project', 'math.js')} so it adds its two arguments. Preserve the comment and function signature. Edit the file directly.`; },
    grade(root, fs) {
      const text = fs.readFileSync(path.join(root, 'project', 'math.js'), 'utf8');
      return { passed: text.includes('return a + b;') && text.includes('// Keep this comment.') && text.includes('export function add(a, b)'),
        detail: 'Expected addition while preserving the existing comment and exported signature.' };
    },
  },
  {
    name: 'Two-file refactor',
    files: { 'project/package.json': '{"name":"orvix-benchmark-b","private":true}',
      'project/src/value.js': 'export const oldLabel = "Orvix";\n',
      'project/src/main.js': 'import { oldLabel } from "./value.js";\nexport const heading = oldLabel + " desktop";\n' },
    prompt(root) { return `In ${path.join(root, 'project')}, rename the exported JavaScript constant oldLabel to productLabel and update its import and use in main.js. Keep the resulting heading behavior unchanged. Edit both files directly.`; },
    grade(root, fs) {
      const value = fs.readFileSync(path.join(root, 'project', 'src', 'value.js'), 'utf8');
      const main = fs.readFileSync(path.join(root, 'project', 'src', 'main.js'), 'utf8');
      return { passed: value.includes('export const productLabel = "Orvix"') && main.includes('import { productLabel }') && main.includes('heading = productLabel + " desktop"') && !main.includes('oldLabel'),
        detail: 'Expected a consistent export, import, and usage rename across files.' };
    },
  },
  {
    name: 'Two independent workspaces',
    files: { 'alpha/package.json': '{"name":"orvix-benchmark-alpha","private":true}',
      'alpha/src/config.js': 'export const appName = "Old Alpha";\n',
      'beta/package.json': '{"name":"orvix-benchmark-beta","private":true}',
      'beta/src/config.js': 'export const appName = "Old Beta";\n' },
    prompt(root) { return `Update ${path.join(root, 'alpha', 'src', 'config.js')} to export appName = "Orvix Alpha" and ${path.join(root, 'beta', 'src', 'config.js')} to export appName = "Orvix Beta". These are separate projects; edit both files directly.`; },
    grade(root, fs) {
      const alpha = fs.readFileSync(path.join(root, 'alpha', 'src', 'config.js'), 'utf8');
      const beta = fs.readFileSync(path.join(root, 'beta', 'src', 'config.js'), 'utf8');
      return { passed: alpha.includes('appName = "Orvix Alpha"') && beta.includes('appName = "Orvix Beta"'),
        detail: 'Expected both project folders to be opened and updated.' };
    },
  },
  {
    name: 'Bug fix with regression preservation',
    files: { 'project/package.json': '{"name":"orvix-benchmark-validation","private":true}',
      'project/src/validate.js': 'export function validName(name) {\n  return name.length > 0;\n}\nexport function validAge(age) {\n  return age >= 0;\n}\n' },
    prompt(root) { return `In ${path.join(root, 'project')}, fix validName so whitespace-only names are rejected without changing validAge. Inspect the file and edit it directly.`; },
    grade(root, fs) { const text = fs.readFileSync(path.join(root, 'project/src/validate.js'), 'utf8');
      return { passed: /name\.trim\(\)\.length\s*>\s*0|name\.trim\(\)\s*!==\s*['"]['"]|Boolean\(name\.trim\(\)\)/.test(text) && text.includes('return age >= 0;'), detail: 'Whitespace rejected; unrelated age behavior preserved.' }; },
    regressions(root, fs) { return fs.readFileSync(path.join(root, 'project/src/validate.js'), 'utf8').includes('return age >= 0;') ? [] : ['validAge changed']; },
  },
  {
    name: 'Preserve unrelated files',
    files: { 'project/package.json': '{"name":"orvix-benchmark-scope","private":true}',
      'project/src/title.js': 'export const title = "Draft";\n', 'project/src/locked.js': 'export const keep = "untouched";\n' },
    prompt(root) { return `Change only ${path.join(root, 'project/src/title.js')} so title is "Ready". Do not edit locked.js.`; },
    grade(root, fs) { const title = fs.readFileSync(path.join(root, 'project/src/title.js'), 'utf8'); const locked = fs.readFileSync(path.join(root, 'project/src/locked.js'), 'utf8');
      return { passed: title.includes('"Ready"') && locked === 'export const keep = "untouched";\n', detail: 'Target change without unrelated edits.' }; },
    regressions(root, fs) { return fs.readFileSync(path.join(root, 'project/src/locked.js'), 'utf8') === 'export const keep = "untouched";\n' ? [] : ['Unrelated file changed']; },
  },
  {
    name: 'Cross-file caller update',
    files: { 'project/package.json': '{"name":"orvix-benchmark-callers","private":true}',
      'project/src/format.js': 'export function formatPrice(value) { return "$" + value; }\n',
      'project/src/cart.js': 'import { formatPrice } from "./format.js";\nexport const total = formatPrice(5);\n' },
    prompt(root) { return `Rename formatPrice to formatAmount throughout ${path.join(root, 'project')} and preserve total's behavior.`; },
    grade(root, fs) { const a = fs.readFileSync(path.join(root, 'project/src/format.js'), 'utf8'); const b = fs.readFileSync(path.join(root, 'project/src/cart.js'), 'utf8');
      return { passed: a.includes('formatAmount') && b.includes('formatAmount') && !a.includes('formatPrice') && !b.includes('formatPrice') && a.includes('"$" + value'), detail: 'Definition and caller updated together.' }; },
    regressions(root, fs) { return fs.readFileSync(path.join(root, 'project/src/format.js'), 'utf8').includes('"$" + value') ? [] : ['Price formatting changed']; },
  },
  {
    name: 'Unknown behavior requires evidence',
    files: { 'project/package.json': '{"name":"orvix-benchmark-evidence","private":true}',
      'project/src/policy.js': 'export const limit = 12;\n' },
    prompt(root) { return `What is the current limit in ${path.join(root, 'project/src/policy.js')}? Answer from the file and do not edit it.`; },
    grade(root, fs, result) { const unchanged = fs.readFileSync(path.join(root, 'project/src/policy.js'), 'utf8') === 'export const limit = 12;\n';
      return { passed: unchanged && /\b12\b/.test(result?.text ?? ''), detail: 'Observed answer with no edit.' }; },
  },
  {
    name: 'No unsupported test pass claim',
    files: { 'project/package.json': '{"name":"orvix-benchmark-no-tests","private":true}',
      'project/src/value.js': 'export const value = 1;\n' },
    prompt(root) { return `Set value to 2 in ${path.join(root, 'project/src/value.js')}. If checks cannot run, state that clearly.`; },
    grade(root, fs, result) { const text = fs.readFileSync(path.join(root, 'project/src/value.js'), 'utf8');
      const unsupported = /(?:tests?|checks?) (?:all )?(?:passed|pass|succeeded)/i.test(result?.text ?? '') && !result?.verification?.checks?.some(check => check.status === 'passed');
      return { passed: text.includes('value = 2') && !unsupported, detail: 'Changed file without inventing a passing check.' }; },
  },
  {
    name: 'Respect explicit instruction in existing code',
    files: { 'project/package.json': '{"name":"orvix-benchmark-guidance","private":true}',
      'project/AGENTS.md': 'Keep public exports stable. Prefer focused edits.\n',
      'project/src/status.js': 'export const status = "old";\nexport const version = 1;\n' },
    prompt(root) { return `Update the status value in ${path.join(root, 'project/src/status.js')} to "active" while keeping its exports stable.`; },
    grade(root, fs) { const text = fs.readFileSync(path.join(root, 'project/src/status.js'), 'utf8');
      return { passed: text.includes('export const status = "active"') && text.includes('export const version = 1'), detail: 'Project guidance and public exports respected.' }; },
  },
  {
    name: 'Failed syntax check then repair',
    files: { 'project/package.json': '{"name":"orvix-benchmark-failed-check","private":true}',
      'project/src/broken.cjs': 'module.exports = function value() {\n  return 1;\n' },
    allowedCommands: ['node --check src/broken.cjs', 'node --check "src\\broken.cjs"', 'node --check "src/broken.cjs"'],
    prompt(root) { return `The syntax check fails in ${path.join(root, 'project', 'src', 'broken.cjs')}. Run node --check src/broken.cjs from ${path.join(root, 'project')} to reproduce, fix only the syntax, then run the same check again.`; },
    grade(root, fs, result) {
      const text = fs.readFileSync(path.join(root, 'project/src/broken.cjs'), 'utf8');
      let valid = true;
      try { new Function(text); } catch { valid = false; }
      const checks = result?.verification?.checks ?? [];
      return { passed: valid && text.includes('return 1;') && checks.some(check => check.status === 'passed' && !check.stale),
        detail: 'Syntax repaired and a post-change check passed.' };
    },
  },
  {
    name: 'Incomplete request needs clarification',
    files: { 'project/package.json': '{"name":"orvix-benchmark-ambiguity","private":true}',
      'project/src/status.js': 'export const status = "ready";\n' },
    prompt(root) { return `Make the status in ${path.join(root, 'project', 'src', 'status.js')} better. I have not said what value or behavior I want.`; },
    grade(root, fs, result) {
      const unchanged = fs.readFileSync(path.join(root, 'project/src/status.js'), 'utf8') === 'export const status = "ready";\n';
      return { passed: unchanged && /\?|clarif|which|what value|intended/i.test(result?.text ?? ''),
        detail: 'No speculative edit; agent asks what status means.' };
    },
  },
];

module.exports = { cases };
