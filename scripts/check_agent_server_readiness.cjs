const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/agentServerStatus.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const fixture = { exports: {} };
vm.runInNewContext(compiled, { exports: fixture.exports, module: fixture });
const { resolveAgentServerState } = fixture.exports;

test('server health and provider preparation remain distinct', () => {
  assert.equal(resolveAgentServerState({ running: true, preparing: true }, false), 'starting');
  assert.equal(resolveAgentServerState({ running: true, preparing: false, prepared: true }, false), 'connected');
  assert.equal(resolveAgentServerState({ running: true, preparing: false, prepared: false }, false), 'connected');
  assert.equal(resolveAgentServerState({ running: true, preparationError: 'Provider initialization failed' }, false), 'offline');
});

test('an active responding worker never appears offline because background preparation failed', () => {
  assert.equal(resolveAgentServerState({ running: true, preparing: true, preparationError: 'Earlier failure' }, true), 'connected');
  assert.equal(resolveAgentServerState({ running: false, starting: true }, false), 'starting');
  assert.equal(resolveAgentServerState(undefined, false), 'offline');
});
