const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { buildSync } = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

test('activity line totals appear once per changed file and never on verification commands', () => {
  const bundled = buildSync({
    entryPoints: [path.join(__dirname, '../src/components/AgentActivityTimeline.tsx')],
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic',
    loader: { '.css': 'empty' },
  });
  const context = { module: { exports: {} }, exports: {}, require, console, process, Buffer, setTimeout, clearTimeout };
  context.exports = context.module.exports;
  vm.runInNewContext(bundled.outputFiles[0].text, context);
  const tools = [
    { id: 'edit-1', name: 'edit', detail: 'src/style.css', input: JSON.stringify({ file: 'C:/project/src/style.css' }), status: 'completed', startedAt: 1 },
    { id: 'edit-2', name: 'write', detail: 'src/style.css', input: JSON.stringify({ file: 'C:/project/src/style.css' }), status: 'completed', startedAt: 2 },
    { id: 'edit-3', name: 'write', detail: 'src/main.js', input: JSON.stringify({ file: 'C:/project/src/main.js' }), status: 'completed', startedAt: 3 },
    { id: 'edit-running', name: 'edit', detail: 'src/style.css', input: JSON.stringify({ file: 'C:/project/src/style.css' }), status: 'running', startedAt: 4 },
    { id: 'verify', name: 'run_command', detail: 'node --check src/main.js', input: '{}', status: 'completed', startedAt: 5 },
  ].map(tool => ({ kind: 'tool', ...tool }));
  const html = renderToStaticMarkup(React.createElement(context.module.exports.AgentActivityTimeline, {
    pending: true,
    items: tools,
    lineChanges: { added: 1196, deleted: 0 },
    fileChanges: [
      { path: 'C:/project/src/style.css', added: 662, deleted: 0 },
      { path: 'C:/project/src/main.js', added: 534, deleted: 0 },
    ],
  }));

  assert.equal((html.match(/class="agent-tool-row-lines"/g) ?? []).length, 2, 'only the two unique changed files carry counts');
  assert.equal((html.match(/>\+662</g) ?? []).length, 1, 'repeated edits do not repeat the final file delta');
  assert.equal((html.match(/>\+534</g) ?? []).length, 1, 'the second changed file is counted once');
  assert.match(html, /Ran 1 command/);
  assert.doesNotMatch(html, /\+1196/);
  assert.match(html, /Final net change for this file during this turn/);
});

test('per-tool line diffs display exact small edit counts instead of cumulative file counts', () => {
  const bundled = buildSync({
    entryPoints: [path.join(__dirname, '../src/components/AgentActivityTimeline.tsx')],
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic',
    loader: { '.css': 'empty' },
  });
  const context = { module: { exports: {} }, exports: {}, require, console, process, Buffer, setTimeout, clearTimeout };
  context.exports = context.module.exports;
  vm.runInNewContext(bundled.outputFiles[0].text, context);

  // Edit tools with explicit old/new text should calculate their own diffs (+2 -1)
  // and NOT show the cumulative 590 lines from fileChanges!
  const tools = [
    {
      id: 'tool-write',
      name: 'write_file',
      detail: 'src/App.tsx',
      input: JSON.stringify({ file: 'C:/project/src/App.tsx' }),
      status: 'completed',
      startedAt: 1,
    },
    {
      id: 'tool-edit-1',
      name: 'edit',
      detail: 'src/App.tsx',
      input: JSON.stringify({
        filePath: 'C:/project/src/App.tsx',
        oldString: 'const a = 1;',
        newString: 'const a = 2;\nconst b = 3;',
      }),
      status: 'completed',
      startedAt: 2,
    },
    {
      id: 'tool-edit-2',
      name: 'apply_edit',
      detail: 'src/App.tsx',
      input: JSON.stringify({
        file: 'C:/project/src/App.tsx',
        diff: { added: 3, deleted: 1 },
      }),
      status: 'completed',
      startedAt: 3,
    },
    {
      id: 'tool-running',
      name: 'edit',
      detail: 'src/App.tsx',
      input: '{}',
      status: 'running',
      startedAt: 4,
    },
  ].map(tool => ({ kind: 'tool', ...tool }));

  const html = renderToStaticMarkup(React.createElement(context.module.exports.AgentActivityTimeline, {
    pending: true,
    items: tools,
    fileChanges: [
      { path: 'C:/project/src/App.tsx', added: 590, deleted: 0 },
    ],
  }));

  // tool-write should own the file's cumulative count (+590 -0)
  assert.match(html, />\+590</);
  // tool-edit-1 should show its own diff (+2 -1), NOT +590
  assert.match(html, />\+2</);
  assert.match(html, />−1</);
  // tool-edit-2 should show its own diff (+3 -1), NOT +590
  assert.match(html, />\+3</);
});

test('Windows extended paths with \\\\?\\ prefix match fileChanges accurately', () => {
  const bundled = buildSync({
    entryPoints: [path.join(__dirname, '../src/components/AgentActivityTimeline.tsx')],
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic',
    loader: { '.css': 'empty' },
  });
  const context = { module: { exports: {} }, exports: {}, require, console, process, Buffer, setTimeout, clearTimeout };
  context.exports = context.module.exports;
  vm.runInNewContext(bundled.outputFiles[0].text, context);

  const tools = [
    {
      id: 'edit-win',
      name: 'write',
      detail: 'src/index.html',
      input: JSON.stringify({ file: '\\\\?\\C:\\project\\src\\index.html' }),
      status: 'completed',
      startedAt: 1,
    },
    {
      id: 'win-running',
      name: 'write',
      detail: 'src/index.html',
      input: '{}',
      status: 'running',
      startedAt: 2,
    },
  ].map(tool => ({ kind: 'tool', ...tool }));

  const html = renderToStaticMarkup(React.createElement(context.module.exports.AgentActivityTimeline, {
    pending: true,
    items: tools,
    fileChanges: [
      { path: 'c:/project/src/index.html', added: 42, deleted: 5 },
    ],
  }));

  assert.match(html, />\+42</);
  assert.match(html, />−5</);
});
