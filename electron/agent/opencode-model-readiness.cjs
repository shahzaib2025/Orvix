function isModelNotFound(id, error) {
  if (error?.modelUnavailable === true && error.modelId === id) return true;
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('\\bModel not found:\\s*' + escaped + '(?=[\\s,?:!]|$|\\.(?:\\s|$))', 'i').test(String(error?.message ?? error));
}

// /config/providers returns the providers used for generation. /provider can
// include unconnected/catalog-only models, and tool metadata accepts unknown
// model IDs; neither establishes that a task can resolve its selected model.
async function resolveOpenCodeModel(api, directory, id, signal, { refresh = true } = {}) {
  if (!/^opencode\/[\w.-]{1,150}$/.test(id)) throw new Error('Invalid OpenCode model identity.');
  for (let attempt = 0; attempt < 2; attempt++) {
    signal?.throwIfAborted();
    try {
      const configured = await api('/config/providers', { directory, signal });
      if (!Array.isArray(configured?.providers)) throw new Error('OpenCode returned invalid configured-provider metadata.');
      const model = configured.providers.find(provider => provider.id === 'opencode')?.models?.[id.slice('opencode/'.length)];
      if (!model) throw new Error('Model not found: ' + id);
      const free = model.cost?.input === 0 && model.cost?.output === 0
        && !Object.values(model.cost?.cache ?? {}).some(value => value !== 0)
        && !model.cost?.tiers?.some(tier => tier.input !== 0 || tier.output !== 0);
      if (!free || !model.capabilities?.input?.text || !model.capabilities?.output?.text || !model.capabilities?.toolcall) {
        const failure = new Error(`The selected model ${id} is not a verified free, tool-capable model in this OpenCode worker. Refresh the model list. This attempt submitted no new model prompt or task action.`);
        failure.modelUnavailable = true; failure.modelId = id;
        throw failure;
      }
      return model;
    } catch (error) {
      if (!isModelNotFound(id, error)) throw error;
      if (error.modelUnavailable) throw error;
      if (!attempt && refresh) {
        // This runs before construction. Never dispose a resumed session's
        // instance or change the selected model to a suggested/paid alias.
        const statuses = await api('/session/status', { directory, signal });
        if (!statuses || typeof statuses !== 'object' || Array.isArray(statuses)) throw new Error('OpenCode could not verify idle sessions before refreshing model metadata.');
        if (Object.values(statuses).every(status => status?.type === 'idle')) {
          await api('/instance/dispose', { method: 'POST', directory, signal });
          continue;
        }
      }
      const failure = new Error(`The selected model ${id} is unavailable in this OpenCode worker. Refresh the model list and choose an available model. This attempt submitted no new model prompt or task action.`, { cause: error });
      failure.modelUnavailable = true;
      failure.modelId = id;
      throw failure;
    }
  }
}
module.exports = { resolveOpenCodeModel, isModelNotFound };
