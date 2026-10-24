// Isolated execution of the generated start/stop functions, not a browser emulation.
const fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto');
const sourceFile = process.argv[2];
const source = fs.readFileSync(sourceFile, 'utf8');
const begin = source.indexOf('var lenis = null;');
const end = source.indexOf('function scrollToTarget(', begin);
if (begin < 0 || end < 0) throw Error('Expected generated lifecycle block not found.');
const lifecycle = source.slice(begin, end);
const state = { rafCalls: 0, destroyed: false };
const callbacks = new Set();
class FakeLenis {
  on() {} off() {}
  raf() { state.rafCalls++; }
  destroy() { state.destroyed = true; }
}
const context = vm.createContext({ window: { Lenis: FakeLenis, ScrollTrigger: { update() {} } }, reduced: { matches: false }, navProgress() {}, gsap: { ticker: { add(fn) { callbacks.add(fn); }, remove(fn) { callbacks.delete(fn); }, lagSmoothing() {} } } });
vm.runInContext(lifecycle, context);
vm.runInContext('startLenis();', context);
for (const callback of callbacks) callback(1);
vm.runInContext('stopLenis();', context);
let error = null;
try { for (const callback of callbacks) callback(2); } catch (caught) { error = caught.message; }
const result = { method: 'Isolated generated-function execution with a Lenis/ticker test double; no real browser preference change is claimed.', sourceFile, sourceHash: crypto.createHash('sha256').update(source).digest('hex'), firstTickCalledRaf: state.rafCalls === 1, destroyed: state.destroyed, callbackRemains: callbacks.size > 0, errorAfterStop: error, defectReproduced: state.destroyed && /null.*raf|raf.*null/.test(error ?? ''), cleanupPassed: state.destroyed && callbacks.size === 0 && error === null };
console.log(JSON.stringify(result, null, 2));
if (!(process.argv.includes('--expect-clean') ? result.cleanupPassed : result.defectReproduced)) process.exitCode = 1;
