/**
 * Yjs CRDT model for the collaborative audit workspace.
 *
 * The shared document holds a single `Y.Map` named `annotations`, keyed by
 * transaction id. Each entry is itself a `Y.Map` so that two auditors editing
 * *different fields* of the same transaction (say one writes a note while the
 * other flags it) both survive the merge — last-writer-wins only applies
 * per-field, which is exactly the conflict behaviour we want.
 *
 * Nothing in this module touches the network or the DOM, so it can be unit
 * tested by wiring two `Y.Doc`s together in-process.
 */

import * as Y from 'yjs';

export interface Annotation {
  txId: string;
  note: string;
  flagged: boolean;
  updatedBy: string;
  updatedAt: number;
}

export interface AnnotationPatch {
  note?: string;
  flagged?: boolean;
}

export const ANNOTATIONS_KEY = 'annotations';

export interface AuditDoc {
  doc: Y.Doc;
  annotations: Y.Map<Y.Map<unknown>>;
}

/** Creates a fresh audit document (optionally reusing an existing `Y.Doc`). */
export function createAuditDoc(existing?: Y.Doc): AuditDoc {
  const doc = existing ?? new Y.Doc();
  const annotations = doc.getMap<Y.Map<unknown>>(ANNOTATIONS_KEY);
  return { doc, annotations };
}

function readEntry(entry: Y.Map<unknown> | undefined, txId: string): Annotation | null {
  if (!entry) return null;
  return {
    txId,
    note: (entry.get('note') as string | undefined) ?? '',
    flagged: (entry.get('flagged') as boolean | undefined) ?? false,
    updatedBy: (entry.get('updatedBy') as string | undefined) ?? '',
    updatedAt: (entry.get('updatedAt') as number | undefined) ?? 0,
  };
}

/**
 * Applies a partial annotation update for `txId` inside one transaction so it
 * produces a single Yjs update. `author` and `at` are recorded for presence /
 * audit-trail display.
 */
export function setAnnotation(
  audit: AuditDoc,
  txId: string,
  patch: AnnotationPatch,
  author: string,
  at: number = Date.now(),
): void {
  const { doc, annotations } = audit;
  doc.transact(() => {
    let entry = annotations.get(txId);
    if (!entry) {
      entry = new Y.Map();
      annotations.set(txId, entry);
    }
    if (patch.note !== undefined) entry.set('note', patch.note);
    if (patch.flagged !== undefined) entry.set('flagged', patch.flagged);
    entry.set('updatedBy', author);
    entry.set('updatedAt', at);
  });
}

export function getAnnotation(audit: AuditDoc, txId: string): Annotation | null {
  return readEntry(audit.annotations.get(txId), txId);
}

/** All annotations, newest edit first. */
export function listAnnotations(audit: AuditDoc): Annotation[] {
  const rows: Annotation[] = [];
  audit.annotations.forEach((entry, txId) => {
    const row = readEntry(entry, txId);
    if (row) rows.push(row);
  });
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Test/helper glue that keeps two docs in sync the way a y-websocket server
 * would: every local update is applied to the peer (tagged with an origin so it
 * does not echo back). Returns a disconnect function.
 */
export function connectAuditDocs(a: AuditDoc, b: AuditDoc): () => void {
  const aToB = (update: Uint8Array, origin: unknown) => {
    if (origin === 'peer-sync') return;
    Y.applyUpdate(b.doc, update, 'peer-sync');
  };
  const bToA = (update: Uint8Array, origin: unknown) => {
    if (origin === 'peer-sync') return;
    Y.applyUpdate(a.doc, update, 'peer-sync');
  };
  a.doc.on('update', aToB);
  b.doc.on('update', bToA);

  // Initial state exchange.
  Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc), 'peer-sync');
  Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc), 'peer-sync');

  return () => {
    a.doc.off('update', aToB);
    b.doc.off('update', bToA);
  };
}

/** A stable colour for a collaborator, derived from their id/name. */
export function presenceColor(id: string): string {
  const palette = [
    '#22d3ee',
    '#a855f7',
    '#f59e0b',
    '#ec4899',
    '#34d399',
    '#60a5fa',
    '#f97316',
    '#c084fc',
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}
