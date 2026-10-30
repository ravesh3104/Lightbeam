/**
 * inbox.ts - browser file picking, download/share handoff, and IndexedDB inbox.
 *
 * On the web there is no app-private POSIX directory, so verified transfers are
 * persisted in IndexedDB (`lightbeam-inbox`) with an automatic in-memory fallback
 * for test environments or restricted private-browsing contexts. Every filename
 * coming off the optical channel passes through `sanitiseFileName` before storage
 * or `<a download>` attribution.
 */

import { LIMITS, formatBytes, sanitiseFileName } from '@lightbeam/core';

export interface PickedWebFile {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

export interface InboxItem {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  receivedAt: number;
  bytes: Uint8Array;
}

export class FileError extends Error {}

const DB_NAME = 'lightbeam-inbox-v1';
const STORE_NAME = 'files';

/** Fallback store when IndexedDB is absent (e.g. jsdom unit tests). */
const memoryInbox = new Map<string, InboxItem>();

const MIME_BY_EXTENSION: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
  html: 'text/html',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  zip: 'application/zip',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
};

export function mimeForName(name: string, fallback = 'application/octet-stream'): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return fallback;
  return MIME_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? fallback;
}

/** Validate and read a browser `File` into a `Uint8Array`. */
export async function readBrowserFile(file: File): Promise<PickedWebFile> {
  if (file.size === 0) {
    throw new FileError('That file is empty.');
  }
  if (file.size > LIMITS.maxPayloadBytes) {
    throw new FileError(
      `${formatBytes(file.size)} exceeds the ${formatBytes(LIMITS.maxPayloadBytes)} optical limit. ` +
        'Over a screen-to-camera link a file that large would take over an hour — use a cable or local network share.',
    );
  }
  const buffer = await file.arrayBuffer();
  const safeName = file.name || 'file.bin';
  return {
    name: safeName,
    mime: file.type || mimeForName(safeName),
    bytes: new Uint8Array(buffer),
  };
}

/** Validate pasted text and convert it into a sender payload. */
export function textPayload(value: string): PickedWebFile {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength === 0) {
    throw new FileError('Nothing to send: paste or type some text first.');
  }
  if (bytes.byteLength > LIMITS.maxTextBytes) {
    throw new FileError(
      `That text is ${formatBytes(bytes.byteLength)}; the text limit is ${formatBytes(LIMITS.maxTextBytes)}. ` +
        'Save it as a file and send that instead.',
    );
  }
  return { bytes, name: 'message.txt', mime: 'text/plain' };
}

/** Create a clean ArrayBuffer-backed Blob from a Uint8Array (safe even on subviews). */
export function toSafeBlob(bytes: Uint8Array, mime: string): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: mime || 'application/octet-stream' });
}

/** Trigger a standard browser file download. */
export function downloadBytes(name: string, bytes: Uint8Array, mime: string): void {
  const safeName = sanitiseFileName(name);
  const blob = toSafeBlob(bytes, mime);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Check whether the browser supports sharing files via the Web Share API. */
export function canWebShareFiles(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
  if (typeof navigator.canShare !== 'function') return false;
  try {
    const probe = new File([new Uint8Array([1])], 'probe.txt', { type: 'text/plain' });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/** Share a received file through the OS/browser share sheet when available. */
export async function shareBrowserFile(name: string, bytes: Uint8Array, mime: string): Promise<void> {
  const safeName = sanitiseFileName(name);
  const blob = toSafeBlob(bytes, mime);
  const file = new File([blob], safeName, { type: mime || 'application/octet-stream' });
  if (!canWebShareFiles()) {
    downloadBytes(safeName, bytes, mime);
    return;
  }
  await navigator.share({ files: [file], title: safeName });
}

/* ---------------------------------------------------------- IndexedDB CRUD */

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

function openInboxDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));
  });
}

/** Save a verified payload into the browser inbox. */
export async function saveReceivedFile(input: {
  name: string;
  mime: string;
  bytes: Uint8Array;
  sha256: string;
}): Promise<InboxItem> {
  const copy = new Uint8Array(input.bytes.byteLength);
  copy.set(input.bytes);
  const safeName = sanitiseFileName(input.name);
  const item: InboxItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name: safeName,
    mime: input.mime || mimeForName(safeName),
    size: copy.byteLength,
    sha256: input.sha256,
    receivedAt: Date.now(),
    bytes: copy,
  };

  if (!hasIndexedDb()) {
    memoryInbox.set(item.id, item);
    return item;
  }

  try {
    const db = await openInboxDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(item);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error ?? new Error('IndexedDB write failed'));
      };
    });
    return item;
  } catch {
    memoryInbox.set(item.id, item);
    return item;
  }
}

/** List all saved inbox files, newest first. */
export async function listInbox(): Promise<InboxItem[]> {
  if (!hasIndexedDb()) {
    return [...memoryInbox.values()].sort((a, b) => b.receivedAt - a.receivedAt);
  }
  try {
    const db = await openInboxDb();
    const rows = await new Promise<InboxItem[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => {
        db.close();
        const items = (req.result as InboxItem[]).map((entry) => ({
          ...entry,
          bytes: entry.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(entry.bytes),
        }));
        resolve(items);
      };
      req.onerror = () => {
        db.close();
        reject(req.error ?? new Error('IndexedDB read failed'));
      };
    });
    return [...rows, ...memoryInbox.values()].sort((a, b) => b.receivedAt - a.receivedAt);
  } catch {
    return [...memoryInbox.values()].sort((a, b) => b.receivedAt - a.receivedAt);
  }
}

/** Delete one file from the browser inbox. */
export async function deleteInboxItem(id: string): Promise<void> {
  memoryInbox.delete(id);
  if (!hasIndexedDb()) return;
  try {
    const db = await openInboxDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error ?? new Error('IndexedDB delete failed'));
      };
    });
  } catch {
    // Already removed from fallback map if present.
  }
}

/** Remove all files from the browser inbox and return how many were deleted. */
export async function clearInbox(): Promise<number> {
  const existing = await listInbox();
  memoryInbox.clear();
  if (hasIndexedDb()) {
    try {
      const db = await openInboxDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error('IndexedDB clear failed'));
        };
      });
    } catch {
      // Ignore storage errors on clear.
    }
  }
  return existing.length;
}
