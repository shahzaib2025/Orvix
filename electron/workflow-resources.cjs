// Shared by conversational tools and detached workflows. UI interaction is a
// single resource because browser and Windows controls can address one window.
const path = require('node:path');
const pending = [];
const running = new Set();
function overlaps(a, b) {
    if (a === b)
        return true;
    if (!a.startsWith('file:') || !b.startsWith('file:'))
        return false;
    const x = a.slice(5).toLowerCase(), y = b.slice(5).toLowerCase();
    return x.startsWith(y + path.sep) || y.startsWith(x + path.sep);
}
function drain() {
    for (const entry of [...pending]) {
        if (entry.signal?.aborted) {
            pending.splice(pending.indexOf(entry), 1);
            entry.signal?.removeEventListener('abort', drain);
            entry.reject(new Error('Operation cancelled.'));
            continue;
        }
        if ([...running].some(other => entry.keys.some(a => other.keys.some(b => overlaps(a, b)))))
            continue;
        pending.splice(pending.indexOf(entry), 1);
        running.add(entry);
        Promise.resolve().then(() => {
            if (entry.signal?.aborted)
                throw new Error('Operation cancelled.');
            return entry.operation();
        })
            .then(entry.resolve, entry.reject).finally(() => { running.delete(entry); entry.signal?.removeEventListener('abort', drain); drain(); });
    }
}
function withResources(keys, operation, signal) {
    return new Promise((resolve, reject) => { pending.push({ keys: [...new Set(keys)], operation, signal, resolve, reject }); signal?.addEventListener('abort', drain, { once: true }); drain(); });
}
module.exports = { withResources, overlaps };
