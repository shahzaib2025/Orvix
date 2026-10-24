const fs = require('node:fs');
const path = require('node:path');
const { redactApiKeys } = require('./api-key-check.cjs');

const NORMAL_ACTIVITY_LIMIT = 320;
const NORMAL_TOOL_OUTPUT_LIMIT = 8_000;

function sanitize(value) {
  if (typeof value === 'string') return redactApiKeys(value);
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item)]));
  return value;
}

function shorten(value, limit) {
  if (typeof value !== 'string' || value.length <= limit) return value;
  const marker = '\n… earlier details condensed …\n';
  const available = Math.max(0, limit - marker.length);
  const head = Math.ceil(available * 0.65);
  return `${value.slice(0, head)}${marker}${value.slice(-(available - head))}`;
}

function compactTask(task, activityLimit, toolOutputLimit) {
  if (!Array.isArray(task?.turns)) return task;
  return {
    ...task,
    turns: task.turns.map(turn => {
      if (!Array.isArray(turn?.activity)) return turn;
      let activity = turn.activity;
      if (activity.length > activityLimit) {
        activity = ['Earlier activity condensed to keep the task responsive.', ...activity.slice(-(activityLimit - 1))];
      }
      activity = activity.map(item => {
        if (typeof item === 'string') return shorten(item, 1_200);
        if (!item || typeof item !== 'object') return item;
        if (item.kind === 'tool') return {
          ...item,
          detail: shorten(item.detail, 500),
          input: shorten(item.input, 1_500),
          output: shorten(item.output, toolOutputLimit),
        };
        if (item.kind === 'progress') return { ...item, text: shorten(item.text, toolOutputLimit) };
        return item;
      });
      return { ...turn, activity };
    }),
  };
}

function compactTasks(tasks, activityLimit, toolOutputLimit) {
  return tasks.map(task => compactTask(task, activityLimit, toolOutputLimit));
}

function createTaskStore(app) {
  const { atomicWrite, readJson, validId } = require('./durable-store.cjs');
  const base = path.join(app.getPath('userData'), 'agent-task-records');
  const manifest = path.join(base, 'index.json');
  const deletedManifest = path.join(base, 'deleted.json');
  const deletedIds = () => new Set(readJson(deletedManifest, []));
  const legacy = path.join(app.getPath('userData'), 'agent-tasks.json');
  function read() {
    const index = readJson(manifest);
    const deleted = deletedIds();
    if (index) return index.files.map(file => { if (!/^[a-f0-9]{64}\.json$/.test(file)) throw new Error('Invalid history record.'); return readJson(path.join(base, file)); }).filter(task => task && !deleted.has(task.id));
    const old = readJson(legacy, []);
    if (!Array.isArray(old)) throw new Error('Invalid legacy history.');
    if (old.length) write(old);
    return compactTasks(sanitize(old), NORMAL_ACTIVITY_LIMIT, NORMAL_TOOL_OUTPUT_LIMIT).filter(task => !deleted.has(task.id));
  }
  function write(tasks) {
    if (!Array.isArray(tasks)) throw new Error('Invalid agent history.');
    const crypto = require('node:crypto');
    const files = [];
    const deleted = deletedIds();
    for (const task of compactTasks(sanitize(tasks), NORMAL_ACTIVITY_LIMIT, NORMAL_TOOL_OUTPUT_LIMIT)) {
      validId(task.id);
      if (deleted.has(task.id)) continue;
      const json = JSON.stringify(task);
      const file = crypto.createHash('sha256').update(json).digest('hex') + '.json';
      if (!fs.existsSync(path.join(base, file))) atomicWrite(path.join(base, file), json);
      files.push(file);
    }
    atomicWrite(manifest, { version: 1, files });
    // The committed manifest makes the replacement atomic across all task records.
    for (const file of fs.readdirSync(base)) if (/^[a-f0-9]{64}\.json$/.test(file) && !files.includes(file)) fs.unlinkSync(path.join(base, file));
    try { fs.unlinkSync(legacy); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return true;
  }
  function forget(taskId) {
    validId(taskId);
    const kept = read().filter(task => task.id !== taskId);
    const deleted = deletedIds(); deleted.add(taskId);
    atomicWrite(deletedManifest, [...deleted]);
    write(kept);
  }
  return { read, write, forget, isDeleted: taskId => deletedIds().has(taskId) };
}
module.exports = { createTaskStore };
