// Protocol rules specific to Gemini Live Extended Thinking.
export function thinkingToolTimeout(name: string): number {
  if (name === "search_class10_textbook" || name === "read_class10_textbook_pages") return 12 * 60_000;
  if (name === "web_search" || name === "read_web_page" || name === "search_files" || name === "search_content") return 30_000;
  return 15_000;
}

export function thinkingCloseDisposition(code: number, reason = ""): { retry: boolean; detail: string } {
  if (/quota|rate.?limit|resource.?exhausted|billing/i.test(reason)) {
    return { retry: false, detail: "Gemini Live quota or billing limit reached. Check usage or try again later." };
  }
  if (code === 1008) return { retry: false, detail: `Gemini rejected access to the Thinking session${reason ? `: ${reason}` : ". Check API access and permissions."}` };
  if (code === 1007) return { retry: false, detail: `Gemini rejected the Thinking session configuration${reason ? `: ${reason}` : "."}` };
  return { retry: true, detail: code === 1011 ? "Gemini encountered a server error. Reconnecting the Thinking session." : "Thinking connection ended. Reconnecting." };
}

export function thinkingToolSucceeded(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const value = result as Record<string, unknown>;
  if (value.ok === false || value.error) return false;
  return value.ok === true || ["ok", "completed", "success", "approved", "paused", "resumed", "deleted", "snoozed", "snooze_cleared"].includes(String(value.status));
}

export function thinkingDirectoryResult(obj: Record<string, unknown>): Record<string, unknown> {
  const allFolders = Array.isArray(obj.folders) ? obj.folders : [];
  const allFiles = Array.isArray(obj.files) ? obj.files : [];
  const folders = allFolders.slice(0, 15);
  const files = allFiles.slice(0, 15);
  const count = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
  const totalItems = count(obj.totalCount) ?? count(obj.totalItems) ?? allFolders.length + allFiles.length;
  const upstreamTruncated = obj.truncated === true || totalItems > allFolders.length + allFiles.length;
  const folderCount = count(obj.folderCount) ?? (upstreamTruncated ? undefined : allFolders.length);
  const fileCount = count(obj.fileCount) ?? (upstreamTruncated ? undefined : allFiles.length);
  const truncated = upstreamTruncated || (folderCount ?? allFolders.length) > folders.length || (fileCount ?? allFiles.length) > files.length;
  return {
    status: obj.status || "ok", directory: String(obj.directory || "Desktop").replace(/\\/g, "/"),
    totalItems, totalCount: totalItems, folderCount, fileCount,
    folders, files, shownFolderCount: folders.length, shownFileCount: files.length, truncated,
    message: `Found ${totalItems} visible items${folderCount !== undefined && fileCount !== undefined ? ` (${folderCount} folders, ${fileCount} files)` : ""}. ${truncated ? `This is a partial list showing ${folders.length} folder names and ${files.length} file names; do not describe it as the complete listing.` : "All visible item names are included."}`,
  };
}
