const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("orvixDesktop", {
  minimize: () => ipcRenderer.invoke("orvix:minimize"),
  toggleMaximize: () => ipcRenderer.invoke("orvix:toggle-maximize"),
  close: () => ipcRenderer.invoke("orvix:close"),
  listCompanionMemories: () => ipcRenderer.invoke('orvix:memory-list'),
  saveCompanionMemory: input => ipcRenderer.invoke('orvix:memory-save', input),
  forgetCompanionMemory: id => ipcRenderer.invoke('orvix:memory-forget', id),
  clearCompanionMemories: () => ipcRenderer.invoke('orvix:memory-clear'),
  configureCompanionMemory: input => ipcRenderer.invoke('orvix:memory-configure', input),
  recallCompanionMemories: input => ipcRenderer.invoke('orvix:memory-recall', input),
  onCompanionMemoryChanged: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('orvix:memory-changed', listener);
    return () => ipcRenderer.removeListener('orvix:memory-changed', listener);
  },
  listScreenSources: () => ipcRenderer.invoke('orvix:screen-sources'),
  selectScreenSource: id => ipcRenderer.invoke('orvix:screen-select',id),
  setPetCaptureExcluded: (active,lease) => ipcRenderer.invoke('orvix:screen-pet-exclusion',active,lease),
  getScreenCaptureGuard: lease => ipcRenderer.invoke('orvix:screen-capture-guard',lease),
  onScreenCaptureStopped: callback => {const listener=()=>callback();ipcRenderer.on('orvix:screen-capture-stopped',listener);return ()=>ipcRenderer.removeListener('orvix:screen-capture-stopped',listener);},
  getPetScreenBounds: () => ipcRenderer.invoke("orvix:pet-screen-bounds"),
  movePetWindow: (x, y) => ipcRenderer.send("orvix:pet-move", x, y),
  onPetPosition: callback => { const listener=(_event,value)=>callback(value);ipcRenderer.on('orvix:pet-position',listener);return ()=>ipcRenderer.removeListener('orvix:pet-position',listener); },
  updatePetOutput: value => ipcRenderer.send("orvix:pet-output-update", value),
  onPetOutput: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on("orvix:pet-output", listener); ipcRenderer.send("orvix:pet-output-ready"); return () => ipcRenderer.removeListener("orvix:pet-output", listener); },
  setPetInteractive: interactive => ipcRenderer.send("orvix:pet-interactive", interactive),
  closePetWindow: () => ipcRenderer.send("orvix:pet-close"),
  getOpenCodeStatus: () => ipcRenderer.invoke("orvix:opencode-status"),
  getAgentWorkers: () => ipcRenderer.invoke('orvix:agent-workers'),
  getOpenCodeKeepAlive: () => ipcRenderer.invoke('orvix:opencode-keepalive'),
  setOpenCodeKeepAlive: (value, taskId) => ipcRenderer.invoke('orvix:opencode-keepalive', value, taskId),
  prepareAgentWorker: (taskId, directory, modelId) => ipcRenderer.invoke('orvix:agent-worker-prepare', taskId, directory, modelId),
  getOpenCodeModels: force => ipcRenderer.invoke('orvix:opencode-models', force),
  onOpenCodeCatalog: callback => { const listener = (_event, catalog) => callback(catalog); ipcRenderer.on('orvix:opencode-catalog', listener); return () => ipcRenderer.removeListener('orvix:opencode-catalog', listener); },
  getKiloModels: force => ipcRenderer.invoke('orvix:kilo-models', force),
  getAntigravityModels: force => ipcRenderer.invoke('orvix:antigravity-models', force),
  getAntigravityStatus: () => ipcRenderer.invoke('orvix:antigravity-status'),
  startAntigravityServer: () => ipcRenderer.invoke('orvix:antigravity-start'),
  stopAntigravityServer: () => ipcRenderer.invoke('orvix:antigravity-stop'),
  createLiveToken: (profile, depth, recovery) => ipcRenderer.invoke("orvix:live-token", profile, depth, recovery),
  setVoiceRefresh: (profile, active) => ipcRenderer.send("orvix:voice-refresh", profile, active),
  getWeather: input => ipcRenderer.invoke("orvix:weather", input),
  cancelFastRead: id => ipcRenderer.invoke("orvix:cancel-fast-read", id),
  searchWeb: input => ipcRenderer.invoke("orvix:search", input),
  listSearchKeys: () => ipcRenderer.invoke('orvix:search-keys-list'),
  addSearchKey: input => ipcRenderer.invoke('orvix:search-keys-add', input),
  updateSearchKey: (id, input) => ipcRenderer.invoke('orvix:search-keys-update', id, input),
  deleteSearchKey: id => ipcRenderer.invoke('orvix:search-keys-delete', id),
  onSearchKeysChanged: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('orvix:search-keys-changed', listener);
    return () => ipcRenderer.removeListener('orvix:search-keys-changed', listener);
  },
  readSearchPage: input => ipcRenderer.invoke("orvix:read-search-page", input),
  searchClass10Textbook: input => ipcRenderer.invoke("orvix:class10-book-search", input),
  readClass10TextbookPages: input => ipcRenderer.invoke("orvix:class10-book-pages", input),
  onTextbookProgress: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("orvix:textbook-progress", listener);
    return () => ipcRenderer.removeListener("orvix:textbook-progress", listener);
  },
  readFile: input => ipcRenderer.invoke("orvix:live-read-file", input),
  openFastExplorer: input => ipcRenderer.invoke('orvix:fast-open-explorer', input),
  fastFileWindow: input => ipcRenderer.invoke('orvix:fast-file-window', input),
  writeFile: input => ipcRenderer.invoke("orvix:live-write-file", input),
  manageClipboard: input => ipcRenderer.invoke("orvix:clipboard", input),
  listDirectory: input => ipcRenderer.invoke("orvix:list-directory", input),
  searchFiles: input => ipcRenderer.invoke("orvix:search-files", input),
  searchContent: input => ipcRenderer.invoke("orvix:search-content", input),
  manageWindow: input => ipcRenderer.invoke("orvix:manage-window", input),
  youtubeAction: input => ipcRenderer.invoke("orvix:youtube-action", input),
  browserObserve: input => ipcRenderer.invoke("orvix:browser-observe", input),
  browserAct: input => ipcRenderer.invoke("orvix:browser-act", input),
  getFastSettings: () => ipcRenderer.invoke('orvix:fast-settings'),
  getStartupSettings: () => ipcRenderer.invoke('orvix:startup-settings'),
  setStartupAtLogin: enabled => ipcRenderer.invoke('orvix:startup-settings-set', enabled),
  getDesktopBarState: () => ipcRenderer.invoke('orvix:desktop-bar-state'),
  setDesktopBarEnabled: enabled => ipcRenderer.invoke('orvix:desktop-bar-set', enabled),
  onDesktopBarStateChanged: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('orvix:desktop-bar-state-changed', listener);
    return () => ipcRenderer.removeListener('orvix:desktop-bar-state-changed', listener);
  },
  configureFast: input => ipcRenderer.invoke('orvix:fast-configure', input),
  updateFastTask: input => ipcRenderer.invoke('orvix:fast-task', input),
  getFastTask: id => ipcRenderer.invoke('orvix:fast-task-state', id),
  registerFastPlan: (id,input) => ipcRenderer.invoke('orvix:fast-plan',id,input),
  reviewFastCompletion: (id,input) => ipcRenderer.invoke('orvix:fast-review',id,input),
  getFastContext: id => ipcRenderer.invoke('orvix:fast-context',id),
  beginFastEvidence: (id,tool,input) => ipcRenderer.invoke('orvix:fast-evidence-start',id,tool,input),
  recordFastEvidence: (id,token,tool,input,result) => ipcRenderer.invoke('orvix:fast-evidence-result',id,token,tool,input,result),
  setFastDelivery: (id,state) => ipcRenderer.invoke('orvix:fast-delivery',id,state),
  executeFast: (taskId, kind, input) => ipcRenderer.invoke('orvix:fast-execute', taskId, kind, input),
  cancelFastTask: taskId => ipcRenderer.send('orvix:fast-cancel', taskId),
  approveFastAction: (id, accepted) => ipcRenderer.invoke('orvix:fast-approve', id, accepted),
  setFastApprovalQueue: enabled => ipcRenderer.invoke('orvix:fast-approval-queue', enabled),
  resumeApprovedFastAction: id => ipcRenderer.invoke('orvix:fast-resume-approved', id),
  onFastWorkEvent: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('orvix:fast-work-event', listener); return () => ipcRenderer.removeListener('orvix:fast-work-event', listener); },
  getBrowserStatus: () => ipcRenderer.invoke("orvix:browser-status"),
  cancelBrowserRequests: ids => ipcRenderer.send("orvix:browser-cancel", ids),
  getPcSnapshot: () => ipcRenderer.invoke("orvix:pc-snapshot"),
  onSessionState: listener => {const callback=(_event,value)=>listener(value);ipcRenderer.on('orvix:session-state',callback);return()=>ipcRenderer.removeListener('orvix:session-state',callback);},
  listTinyAgents: () => ipcRenderer.invoke("orvix:tiny-agents-list"),
  listTinyWorkflows: () => ipcRenderer.invoke('orvix:tiny-workflows-list'),
  tinyWorkflowCapabilities: () => ipcRenderer.invoke('orvix:tiny-workflows-capabilities'),
  inspectTinyWorkflow: input => ipcRenderer.invoke('orvix:tiny-workflows-inspect',input),
  tinyWorkflowHistory: input => ipcRenderer.invoke('orvix:tiny-workflows-history',input),
  draftTinyWorkflow: input => ipcRenderer.invoke('orvix:tiny-workflows-draft',input),
  manageTinyWorkflow: input => ipcRenderer.invoke('orvix:tiny-workflows-manage',input),
  recordTinyWorkflowVoiceInput: input => ipcRenderer.invoke('orvix:tiny-workflows-human-input',input),
  onTinyWorkflowEvent: callback => {const listener=(_event,value)=>callback(value);ipcRenderer.on('orvix:tiny-workflow-event',listener);return ()=>ipcRenderer.removeListener('orvix:tiny-workflow-event',listener);},
  listConstructionLocks: () => ipcRenderer.invoke('orvix:construction-lock-list'),
  previewConstructionLock: input => ipcRenderer.invoke('orvix:construction-lock-preview',input),
  controlConstructionLock: input => ipcRenderer.invoke('orvix:construction-lock-control',input),
  startConstructionLock: input => ipcRenderer.invoke('orvix:construction-lock-start', input),
  unlockConstructionLock: id => ipcRenderer.invoke('orvix:construction-lock-unlock', id),
  openConstructionRecovery: () => ipcRenderer.invoke('orvix:construction-lock-recovery'),
  createTinyStagingCopy: input => ipcRenderer.invoke('orvix:tiny-staging-create', input),
  tinyRuntimeHealth: () => ipcRenderer.invoke('orvix:tiny-runtime-health'),
  controlTinyRuntime: input => ipcRenderer.invoke('orvix:tiny-runtime-control', input),
  onTinyRuntimeControl: callback => {const listener=(_event,value)=>callback(value);ipcRenderer.on('orvix:tiny-runtime-control',listener);return()=>ipcRenderer.removeListener('orvix:tiny-runtime-control',listener);},
  onWindowBackgrounded: callback => {const listener=()=>callback();ipcRenderer.on('orvix:window-backgrounded',listener);return()=>ipcRenderer.removeListener('orvix:window-backgrounded',listener);},
  draftTinyAgent: input => ipcRenderer.invoke("orvix:tiny-agents-draft", input),
  approveTinyAgent: id => ipcRenderer.invoke("orvix:tiny-agents-approve", id),
  setTinyAgentEnabled: (id, enabled) => ipcRenderer.invoke("orvix:tiny-agents-enabled", id, enabled),
  deleteTinyAgent: id => ipcRenderer.invoke("orvix:tiny-agents-delete", id),
  cancelTinyAgentShutdown: () => ipcRenderer.invoke("orvix:tiny-agents-cancel-shutdown"),
  retryTinyAgentNotification: id => ipcRenderer.invoke('orvix:tiny-agents-retry-notification', id),
  previewTinyAgent: input => ipcRenderer.invoke('orvix:tiny-agents-preview', input),
  snoozeTinyAgent: (id, seconds) => ipcRenderer.invoke('orvix:tiny-agents-snooze', id, seconds),
  duplicateTinyAgent: id => ipcRenderer.invoke('orvix:tiny-agents-duplicate', id),
  pickTinyAgentPath: kind => ipcRenderer.invoke('orvix:tiny-agents-pick-path', kind),
  testNotification: () => ipcRenderer.invoke('orvix:notification-test'),
  getAgentNotifications: () => ipcRenderer.invoke('orvix:agent-notifications-read'),
  markAgentNotificationRead: id => ipcRenderer.invoke('orvix:agent-notifications-mark-read', id),
  markAllAgentNotificationsRead: () => ipcRenderer.invoke('orvix:agent-notifications-mark-all-read'),
  onNotificationOpen: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('orvix:notification-open', listener);
    return () => ipcRenderer.removeListener('orvix:notification-open', listener);
  },
  onTinyAgentEvent: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("orvix:tiny-agent-event", listener);
    return () => ipcRenderer.removeListener("orvix:tiny-agent-event", listener);
  },
  onAgentNotifications: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('orvix:agent-notifications', listener);
    return () => ipcRenderer.removeListener('orvix:agent-notifications', listener);
  },
  logLive: (type, message, details) => ipcRenderer.send("orvix:live-log", type, message, details),
  setOpenCodeKey: (tier, key) => ipcRenderer.invoke("orvix:opencode-set-key", tier, key),
  changeAgentProviderKey: (tier, input) => ipcRenderer.invoke('orvix:agent-provider-key-change', tier, input),
  runAgent: input => ipcRenderer.invoke("orvix:agent-run", input),
  cancelAgent: taskId => ipcRenderer.send("orvix:agent-cancel", taskId),
  steerAgent: (taskId, text) => ipcRenderer.invoke("orvix:agent-steer", taskId, text),
  approveAgentCommand: (approvalId, accepted) => ipcRenderer.invoke("orvix:agent-approve", approvalId, accepted),
  getAgentApprovalDiff: (approvalId, file) => ipcRenderer.invoke("orvix:agent-approval-diff", approvalId, file),
  getAgentChanges: taskId => ipcRenderer.invoke("orvix:agent-changes", taskId),
  getAgentWorkspaces: taskId => ipcRenderer.invoke("orvix:agent-workspaces", taskId),
  listAgentWorkspaceFiles: (taskId, root) => ipcRenderer.invoke("orvix:agent-workspace-files", taskId, root),
  readAgentWorkspaceFile: (taskId, file) => ipcRenderer.invoke("orvix:agent-workspace-file", taskId, file),
  getAgentDeliverables: (taskId, requestId) => ipcRenderer.invoke('orvix:agent-deliverables', taskId, requestId),
  previewAgentFile: (taskId, file) => ipcRenderer.invoke('orvix:agent-file-preview', taskId, file),
  actOnAgentFile: (taskId, file, action) => ipcRenderer.invoke('orvix:agent-file-action', taskId, file, action),
  getAgentApproval: taskId => ipcRenderer.invoke('orvix:agent-pending-approval', taskId),
  getAgentScorecard: taskId => ipcRenderer.invoke('orvix:agent-scorecard', taskId),
  getAgentRunState: (taskId, requestId) => ipcRenderer.invoke('orvix:agent-run-state', taskId, requestId),
  getAgentCheckpoint: taskId => ipcRenderer.invoke("orvix:agent-checkpoint", taskId),
  getAgentQuestion: (taskId, requestId) => ipcRenderer.invoke('orvix:agent-question', taskId, requestId),
  getAgentReviewImage: (taskId, requestId, imageId) => ipcRenderer.invoke('orvix:agent-review-image', taskId, requestId, imageId),
  answerAgentQuestion: (questionId, answer) => ipcRenderer.invoke('orvix:agent-answer-question', questionId, answer),
  getAgentExecution: (taskId, requestId, refresh = false) => ipcRenderer.invoke('orvix:agent-execution', taskId, requestId, refresh),
  listAgentEvidence: (taskId, requestId, offset) => ipcRenderer.invoke('orvix:agent-evidence-list', taskId, requestId, offset),
  readAgentEvidence: (taskId, requestId, id, offset) => ipcRenderer.invoke('orvix:agent-evidence-read', taskId, requestId, id, offset),
  getAgentTaskMemory: taskId => ipcRenderer.invoke("orvix:agent-task-memory", taskId),
  getAgentSandboxStatus: () => ipcRenderer.invoke("orvix:agent-sandbox-status"),
  getAgentDiff: (taskId, file) => ipcRenderer.invoke("orvix:agent-diff", taskId, file),
  getAgentTurnReport: (taskId, requestId) => ipcRenderer.invoke("orvix:agent-turn-report", taskId, requestId),
  getAgentTurnDiff: (taskId, requestId, file) => ipcRenderer.invoke("orvix:agent-turn-diff", taskId, requestId, file),
  restoreAgentChange: (taskId, file) => ipcRenderer.invoke("orvix:agent-restore", taskId, file),
  forgetAgentChanges: taskId => ipcRenderer.invoke("orvix:agent-forget", taskId),
  readAgentTasks: () => ipcRenderer.invoke("orvix:agent-tasks-read"),
  writeAgentTasks: tasks => ipcRenderer.invoke("orvix:agent-tasks-write", tasks),
  onAgentEvent: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("orvix:agent-event", listener);
    return () => ipcRenderer.removeListener("orvix:agent-event", listener);
  },
  onDesktopActivity: callback => {
    const listener = () => callback();
    ipcRenderer.on("orvix:desktop-activity", listener);
    return () => ipcRenderer.removeListener("orvix:desktop-activity", listener);
  },
  onPcEvent: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("orvix:pc-event", listener);
    return () => ipcRenderer.removeListener("orvix:pc-event", listener);
  },
});
