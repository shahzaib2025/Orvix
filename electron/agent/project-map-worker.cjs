const { parentPort, workerData } = require('node:worker_threads');
const { createProjectMap } = require('./project-map.cjs');
const { createWorkspaceManager } = require('./workspace-manager.cjs');
const app = { getPath: () => workerData.userData };
const maps = createProjectMap(app);
const workspaces = createWorkspaceManager(app);
const controllers = new Map();
let queue = Promise.resolve();
parentPort.on('message', message => {
  if (message.cancel) { controllers.get(message.id)?.abort(); return; }
  const controller = new AbortController(); controllers.set(message.id, controller);
  queue = queue.then(async () => {
    try {
      const result = await maps.refresh(message.root, message.taskId, workspaces, controller.signal);
      parentPort.postMessage({ id: message.id, result });
    } catch (error) { parentPort.postMessage({ id: message.id, error: error.message }); }
    finally { controllers.delete(message.id); }
  });
});
