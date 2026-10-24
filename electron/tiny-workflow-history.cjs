const fs = require('node:fs');

// Read one page without retaining the entire append-only journal in memory.
// Buffers, rather than decoded chunks, preserve UTF-8 split across reads.
function* journalLines(fd, size, reverse) {
    const blockSize = 65536;
    let position = reverse ? size : 0, carry = Buffer.alloc(0);
    while (reverse ? position > 0 : position < size) {
        const length = Math.min(blockSize, reverse ? position : size - position);
        const start = reverse ? position - length : position;
        const block = Buffer.allocUnsafe(length);
        const read = fs.readSync(fd, block, 0, length, start);
        if (!read) break;
        position = reverse ? start : position + read;
        const bytes = reverse ? Buffer.concat([block.subarray(0, read), carry]) : Buffer.concat([carry, block.subarray(0, read)]);
        if (reverse) {
            let end = bytes.length;
            for (let index = bytes.length - 1; index >= 0; index--) if (bytes[index] === 10) {
                if (index + 1 < end) yield bytes.subarray(index + 1, end).toString('utf8');
                end = index;
            }
            carry = bytes.subarray(0, end);
        } else {
            let start = 0;
            for (let index = 0; index < bytes.length; index++) if (bytes[index] === 10) {
                if (start < index) yield bytes.subarray(start, index).toString('utf8');
                start = index + 1;
            }
            carry = bytes.subarray(start);
        }
        if (carry.length > 16 * 1024 * 1024) throw new Error('A workflow history record exceeds the supported size. The journal has been preserved.');
    }
    if (carry.length) yield carry.toString('utf8');
}
function readHistoryPage(file, sequence, input = {}) {
    const forward = input.after !== undefined, records = [];
    let fd;
    try {
        fd = fs.openSync(file, 'r');
        for (const line of journalLines(fd, fs.fstatSync(fd).size, !forward)) {
            let value;
            try { value = JSON.parse(line); } catch { continue; }
            if (value.sequence > sequence || value.sequence <= Number(input.after ?? 0) || value.sequence >= Number(input.before ?? Infinity) || input.runId && value.runId !== input.runId) continue;
            records.push(value);
            if (records.length === 51) break;
        }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    finally { if (fd !== undefined) fs.closeSync(fd); }
    const more = records.length > 50;
    const page = records.slice(0, 50);
    if (!forward) page.reverse();
    return { records: page, next: more ? (forward ? page.at(-1).sequence : page[0].sequence) : null, sequence };
}
module.exports = { readHistoryPage };
