export function localFileTarget(target: string): string | null {
  let value = target.trim().replace(/^<([\s\S]*)>$/, "$1");
  if (!/^(?:[a-z]:[\\/]|\/(?!\/)|\\\\)/i.test(value) || /[\x00-\x1f]/.test(value)) return null;
  value = value.replace(/:\d+(?::\d+)?$/, "");
  return value;
}

export function referencedLocalFiles(text: string): string[] {
  return Array.from(text.matchAll(/\[[^\]\n]+\]\((<[^>\n]+>|[^)\n]+)\)/g), match => localFileTarget(match[1])).filter((value): value is string => value !== null);
}

// Relative names are clickable only when this turn identifies one exact file.
export function resolveAgentFileTarget(target: string, files: string[]): string | null {
  const absolute = localFileTarget(target);
  if (absolute) return absolute;
  const relative = target.trim().replace(/^<([\s\S]*)>$/, '$1').replace(/:\d+(?::\d+)?$/, '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  if (!relative || /[\x00-\x1f]/.test(relative) || relative.split('/').includes('..') || /^[a-z]+:/i.test(relative)) return null;
  const matches = files.filter(file => {
    const path = file.replace(/\\/g, '/').toLowerCase();
    return path === relative || path.endsWith('/' + relative);
  });
  return matches.length === 1 ? matches[0] : null;
}
