const clean = (value, limit = 1200) => String(value ?? '').trim().slice(0, limit);
const list = (value, limit = 12) => Array.isArray(value)
  ? [...new Set(value.map(item => clean(item, 500)).filter(Boolean))].slice(0, limit) : [];

function createTaskContract(request, previous) {
  const current = previous && previous.version === 1 ? previous : {};
  return {
    version: 1,
    objective: clean(current.objective || request, 4000),
    constraints: list(current.constraints),
    acceptance: list(current.acceptance),
    workspaces: list(current.workspaces),
    openQuestions: list(current.openQuestions),
    updatedAt: Date.now(),
  };
}

function updateTaskContract(current, input, openedWorkspaces) {
  const next = createTaskContract(current.objective, current);
  if (typeof input.objective === 'string' && input.objective.trim()) next.objective = clean(input.objective, 4000);
  for (const field of ['constraints', 'acceptance', 'openQuestions']) {
    if (input[field] !== undefined) next[field] = list(input[field]);
  }
  if (input.workspaces !== undefined) {
    const allowed = new Set(openedWorkspaces.map(item => item.toLowerCase()));
    next.workspaces = list(input.workspaces).filter(item => allowed.has(item.toLowerCase()));
  }
  return next;
}

function contractContext(contract) {
  if (!contract) return '';
  return [
    `Objective: ${contract.objective}`,
    `Constraints: ${contract.constraints.join('; ') || 'None recorded'}`,
    `Acceptance criteria: ${contract.acceptance.join('; ') || 'Not yet recorded'}`,
    `Relevant workspaces: ${contract.workspaces.join('; ') || 'Not yet located'}`,
    `Open questions: ${contract.openQuestions.join('; ') || 'None recorded'}`,
  ].join('\n');
}

module.exports = { createTaskContract, updateTaskContract, contractContext };
