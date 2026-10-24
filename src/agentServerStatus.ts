import type { AgentServerIndicator, AgentWorkerStatus } from './desktop';

export function resolveAgentServerState(
  worker: AgentWorkerStatus | undefined,
  activeOpenCodeRun: boolean,
): AgentServerIndicator['state'] {
  if (!activeOpenCodeRun && worker?.preparationError) return 'offline';
  if (!activeOpenCodeRun && worker?.running && worker.preparing) return 'starting';
  if (worker?.running) return 'connected';
  if (worker?.starting || activeOpenCodeRun) return 'starting';
  return 'offline';
}
