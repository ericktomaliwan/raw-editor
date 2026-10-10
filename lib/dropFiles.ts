/**
 * Expand a drop's DataTransfer into a flat list of files, descending into any
 * dropped folders. Uses the (widely supported) `webkitGetAsEntry` API because a
 * dropped directory appears in `dataTransfer.files` as a 0-byte placeholder.
 *
 * Must be called synchronously from the `drop` handler: the items list is
 * only readable during the event. All the async work happens afterwards.
 */

export interface DroppedFile {
  file: File;
  /** Path relative to the drop (e.g. "Pack/Portra/1a. Portra 160.xmp"); just the name for loose files. */
  path: string;
  /** Name of the immediate parent folder when the file came from a dropped folder. */
  folder?: string;
}

/** An item that can yield a filesystem entry. Narrowed to the standard shape. */
type EntryItem = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntry | null;
};

export function collectDroppedFiles(dt: DataTransfer): Promise<DroppedFile[]> {
  const items = Array.from(dt.items ?? []) as EntryItem[];
  const entries: FileSystemEntry[] = [];
  let entriesSupported = false;

  for (const item of items) {
    if (item.kind !== "file") continue;
    if (typeof item.webkitGetAsEntry === "function") {
      entriesSupported = true;
      const entry = item.webkitGetAsEntry();
      if (entry) entries.push(entry);
    }
  }

  if (!entriesSupported || entries.length === 0) {
    // Fallback: plain files only (no folder support in this browser).
    return Promise.resolve(
      Array.from(dt.files).map((file) => ({ file, path: file.name })),
    );
  }

  return (async () => {
    const out: DroppedFile[] = [];
    for (const entry of entries) await walk(entry, "", out);
    return out;
  })();
}

async function walk(entry: FileSystemEntry, parentPath: string, out: DroppedFile[]) {
  const name = entry.name;
  // Skip macOS resource forks / hidden files inside dropped folders.
  if (name.startsWith(".") || name === "__MACOSX") return;
  const path = parentPath ? `${parentPath}/${name}` : name;

  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    ).catch(() => null);
    if (file) {
      out.push({
        file,
        path,
        folder: parentPath ? parentPath.split("/").pop() : undefined,
      });
    }
    return;
  }

  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns results in batches (Chrome caps at 100); loop until empty.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      ).catch(() => [] as FileSystemEntry[]);
      if (!batch.length) break;
      for (const child of batch) await walk(child, path, out);
    }
  }
}
