const positiveCheckClaim = /\b(?:all\s+)?(?:tests?|checks?)\s+(?:have\s+)?(?:passed|pass|succeeded)\b/i;
const positiveFlowClaim = /\b(?:user\s*flow|ui|interface)\s+(?:was\s+|is\s+)?(?:tested|verified|checked)\b/i;
const positiveVisualClaim = /\b(?:(?:screenshots?|visuals?|page\s+render)\s+(?:was\s+|were\s+|have\s+been\s+)?(?:inspected|reviewed|verified|checked)|(?:inspected|reviewed|verified|checked)\s+(?:the\s+)?(?:screenshots?|visuals?|page\s+render))\b/i;

function activeChecks(verification) {
  return (verification?.checks ?? []).filter(check => check.phase !== 'reproduce' && !check.stale && !check.superseded);
}

function auditReply(text, verification, previewObserved) {
  const lines = String(text ?? '').split(/\r?\n/);
  const checks = activeChecks(verification);
  const flowPassed = checks.some(check => check.phase === 'user_flow' && check.status === 'passed');
  const issues = [];
  const observedCounts = new Set(checks.filter(check => check.status === 'passed').flatMap(check => [...String(check.output ?? '').matchAll(/(?:\b(?:pass|passed)\s*[:=]?\s*(\d+)\b|\b(\d+)\s+(?:tests?\s+)?passed\b)/gi)].map(match => Number(match[1] ?? match[2]))));
  observedCounts.add(checks.filter(check => check.status === 'passed').length);
  for (const line of lines) {
    const negated = match => /\b(?:no|not|never|cannot|can't|couldn't|without|didn't|weren't)(?:\s+\w+){0,3}\s*$/i.test(line.slice(Math.max(0, match.index - 45), match.index));
    const executedClaim = /\b(?:I|we)\s+(?:ran|executed)\s+(?:(?:the|these|those|both|all|rejected|proposed|verification|scope|post-fix|independent)\s+)*(?:commands?|checks?|assertions?|tests?|them)\b/i.exec(line);
    const actualPostCommands = checks.filter(item => item.commandEvidenceId || item.source === 'automatic' && item.evidenceId && /^Exit -?\d+\b/.test(item.output ?? ''));
    const identities = new Set(actualPostCommands.map(item => item.commandEvidenceId ?? item.evidenceId));
    const executionCount = /\b(?:observed|ran|executed|recorded)\s+(?:only\s+)?(one|two|\d+)\s+(?:distinct\s+)?post[- ](?:edit|fix|change)\s+(?:executions?|runs?)\b/i.exec(line);
    if (executionCount && identities.size && ({ one: 1, two: 2 }[executionCount[1].toLowerCase()] ?? Number(executionCount[1])) !== identities.size) issues.push('The claimed execution count conflicts with distinct recorded command logs. Source fingerprints describe state, not execution identity.');
    if (/\b(?:same|identical)\s+(?:recorded\s+)?command\s+result\b/i.test(line) && /state.?fingerprint/i.test(line) && identities.size > 1) issues.push('Identical source fingerprints do not make distinct command executions the same recorded result.');
    if (executedClaim && !negated(executedClaim)) {
      const outcomes = (verification?.toolOutcomes ?? []).filter(item => ['verify_work', 'run_command'].includes(item.name));
      if (outcomes.length && !outcomes.some(item => item.executed) || /\b(?:rejected|declined|blocked|did not execute|before execution)\b/i.test(line) && outcomes.some(item => !item.executed)) issues.push('A rejected command proposal cannot be described as executed.');
    }
    // A named command has to match an actual execution, rather than any passing check.
    for (const match of line.matchAll(/`([^`]+)`/g)) {
      if (!/^(?:npm|pnpm|yarn|node|python|go|cargo|dotnet|mvn)\s/.test(match[1])) continue;
      if (!/\b(?:ran|executed|passed|exit\s*0|exit\s*code\s*0)\b/i.test(line) || /\b(?:didn't|did not|not run|not executed|not checked|proposed|will|would|could)\b/i.test(line)) continue;
      const actual = [...(verification?.checks ?? []).filter(item => !item.stale && !item.superseded), ...(verification?.toolOutcomes ?? []).filter(item => item.executed)];
      const formattedCommand = match[1].replace(/\\\|/g, '|').trim();
      if (!actual.some(item => item.command?.trim() === formattedCommand)) issues.push('A named command execution claim has no matching observed command result.');
    }
    const completeMatch = /\b(?:all (?:requirements|tasks|requested features) (?:are |have been )?(?:complete|completed|implemented|verified)|(?:task|work|implementation) (?:is )?(?:complete|completed)|everything (?:is )?(?:done|working))\b/i.exec(line);
    if (completeMatch && !negated(completeMatch) && (verification?.executionPending || verification?.requirements?.some(item => !['verified', 'supported'].includes(item.status)))) issues.push('A completion claim is unsupported because requirements remain unverified.');
    const checkMatch = positiveCheckClaim.exec(line);
    const countedClaim = /\b(\d+)\s+(?:(?:existing|regression|automated|unit)\s+)*(?:tests?|checks?)\s+(?:(?:now|all|have|has)\s+)*(?:pass|passed|succeeded)\b/i.exec(line);
    if (countedClaim && !negated(countedClaim) && !observedCounts.has(Number(countedClaim[1]))) issues.push('The claimed passing count has no matching recorded check summary.');
    const relevantChecks = checkMatch && /\btests?\b/i.test(checkMatch[0])
      ? checks.filter(check => ['focused', 'typecheck', 'regression', 'build', 'user_flow'].includes(check.phase)) : checks;
    if (checkMatch && !negated(checkMatch) && (!relevantChecks.some(check => check.status === 'passed')
      || (/\ball\b/i.test(checkMatch[0]) && !(relevantChecks.length && relevantChecks.every(check => check.status === 'passed')))))
      issues.push('A passing-check claim is unsupported by current post-change evidence.');
    const flowMatch = positiveFlowClaim.exec(line);
    if (flowMatch && !negated(flowMatch) && !flowPassed) issues.push('A user-flow verification claim is unsupported.');
    const visualMatch = positiveVisualClaim.exec(line);
    if (visualMatch && !negated(visualMatch) && !previewObserved) issues.push('A visual inspection claim is unsupported.');
  }
  return [...new Set(issues)];
}

function removeUnsupportedClaims(text, verification, previewObserved) {
  return String(text ?? '').split(/\r?\n/).filter(line => !auditReply(line, verification, previewObserved).length).join('\n').trim();
}

module.exports = { auditReply, removeUnsupportedClaims };
