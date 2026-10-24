const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { canonicalTarget } = require('./agent/workspace-manager.cjs');
const { isSensitiveFile, credentialDirectories } = require('./agent/file-policy.cjs');
const { withResources } = require('./workflow-resources.cjs');
const inside = (a, b) => a.toLowerCase() === b.toLowerCase() || a.toLowerCase().startsWith(b.toLowerCase() + path.sep);
async function hash(file) { const value = createHash('sha256'); for await (const chunk of require('node:fs').createReadStream(file)) value.update(chunk); return value.digest('hex'); }
async function createStagingCopy({ targets, destination }) {
    if (!Array.isArray(targets) || !targets.length || targets.length > 12 || !path.isAbsolute(destination || '')) throw new Error('Choose work files and a destination folder.');
    const sources = targets.map(target => canonicalTarget(target)), parent = canonicalTarget(destination);
    if (sources.some(source => inside(parent, source) || inside(source, parent))) throw new Error('Choose a separate destination outside the source folders.');
    const entries = [], names = new Set(); let bytes = 0;
    async function collect(source, relative) {
        if (entries.length >= 2000) throw new Error('Choose at most 2,000 entries for a staging copy.');
        const stat = await fs.lstat(source);
        if (stat.isSymbolicLink() || stat.nlink > 1 && stat.isFile() || isSensitiveFile(source) || source.split(path.sep).some(part => credentialDirectories.has(part.toLowerCase()))) throw new Error('Staging excludes links, aliases and credential locations.');
        if (!stat.isFile() && !stat.isDirectory()) throw new Error('Choose ordinary files and folders.');
        bytes += stat.isFile() ? stat.size : 0;
        if (bytes > 1024 * 1024 * 1024) throw new Error('Choose less than 1 GB for one staging copy.');
        const entry = { source, relative, directory: stat.isDirectory(), hash: stat.isFile() ? await hash(source) : undefined };
        entries.push(entry);
        if (stat.isDirectory()) for (const name of await fs.readdir(source)) await collect(path.join(source, name), path.join(relative, name));
    }
    return withResources(sources.map(source => 'file:' + source), async () => {
        for (const source of sources) { const name = path.basename(source); if (names.has(name.toLowerCase())) throw new Error('Source names must be distinct.'); names.add(name.toLowerCase()); await collect(source, name); }
        const directory = path.join(parent, 'Orvix-staging-' + randomUUID());
        await fs.mkdir(directory); // Never reuse or overwrite an existing workspace.
        try {
            for (const entry of entries) {
                const target = path.join(directory, entry.relative);
                if (entry.directory) await fs.mkdir(target);
                else { await fs.copyFile(entry.source, target, require('node:fs').constants.COPYFILE_EXCL);
                    if (await hash(target) !== entry.hash || await hash(entry.source) !== entry.hash) throw new Error('A source changed while copying. Review it and create a fresh copy.'); }
            }
            const receipt = { version: 1, directory, createdAt: Date.now(), status: 'copy_verified', originalsModified: false, automaticPublish: false, entries };
            const handle = await fs.open(path.join(directory, 'orvix-staging-receipt.json'), 'wx');
            try { await handle.writeFile(JSON.stringify(receipt, null, 2)); await handle.sync(); } finally { await handle.close(); }
            return receipt;
        } catch (error) { throw new Error(error.message + ' Originals were not changed. Partial copy: ' + directory); }
    });
}
module.exports = { createStagingCopy };
