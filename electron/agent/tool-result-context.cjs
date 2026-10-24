// The evidence archive retains the complete output; only prompt context is folded.
function toolResultContext(name, value, failed) {
  const text = String(value);
  if (name === 'read_agent_skill' && !failed) return text;
  if (name !== 'run_command' || failed || !/^Exit 0(?:\r?\n|$)/.test(text) || text.length <= 6000) return text.slice(0, 28000);
  return text.slice(0, 3000) + `\n[Successful command output shortened from ${text.length} characters; complete output is saved in evidence.]\n` + text.slice(-3000);
}
module.exports = { toolResultContext };
