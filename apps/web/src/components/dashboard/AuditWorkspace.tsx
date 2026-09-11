'use client';

import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { WebsocketProvider } from 'y-websocket';
import type { PaymentDTO } from '@stellar-alerts/shared';
import {
  createAuditDoc,
  getAnnotation,
  setAnnotation,
  listAnnotations,
  presenceColor,
  type AuditDoc,
} from './auditWorkspace.crdt';

export interface AuditCollaborator {
  id: string;
  name: string;
}

interface AuditWorkspaceProps {
  payments: PaymentDTO[];
  currentUser: AuditCollaborator;
  /** Distinct audit room; collaborators sharing a room see each other's edits. */
  roomId?: string;
}

interface PresenceState {
  user?: AuditCollaborator & { color: string };
  cursor?: { x: number; y: number } | null;
}

const WS_URL = process.env.NEXT_PUBLIC_YJS_WS_URL || 'ws://localhost:1234';

export const AuditWorkspace: React.FC<AuditWorkspaceProps> = ({
  payments = [],
  currentUser,
  roomId = 'default',
}) => {
  // One Y.Doc for the lifetime of the component instance.
  const [audit] = useState<AuditDoc>(createAuditDoc);

  const [, bumpVersion] = useReducer((n: number) => n + 1, 0);
  const [peers, setPeers] = useState<PresenceState[]>([]);
  const [connected, setConnected] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);

  const localColor = useMemo(() => presenceColor(currentUser.id), [currentUser.id]);

  // Re-render whenever any annotation changes (local or remote).
  useEffect(() => {
    const handler = () => bumpVersion();
    audit.annotations.observeDeep(handler);
    return () => audit.annotations.unobserveDeep(handler);
  }, [audit]);

  // Connect to the collaboration server and wire up awareness (presence + cursors).
  useEffect(() => {
    const provider = new WebsocketProvider(WS_URL, `stellar-audit-${roomId}`, audit.doc, {
      connect: true,
    });
    providerRef.current = provider;

    provider.awareness.setLocalStateField('user', {
      id: currentUser.id,
      name: currentUser.name,
      color: localColor,
    });

    const onAwareness = () => {
      const states: PresenceState[] = [];
      provider.awareness.getStates().forEach((state, clientId) => {
        if (clientId === provider.awareness.clientID) return;
        states.push(state as PresenceState);
      });
      setPeers(states);
    };
    const onStatus = (event: { status: string }) => setConnected(event.status === 'connected');

    provider.awareness.on('change', onAwareness);
    provider.on('status', onStatus);
    onAwareness();

    return () => {
      provider.awareness.off('change', onAwareness);
      provider.off('status', onStatus);
      provider.destroy();
      providerRef.current = null;
    };
  }, [audit, roomId, currentUser.id, currentUser.name, localColor]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const surface = surfaceRef.current;
    const provider = providerRef.current;
    if (!surface || !provider) return;
    const rect = surface.getBoundingClientRect();
    provider.awareness.setLocalStateField('cursor', {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    });
  }, []);

  const handlePointerLeave = useCallback(() => {
    providerRef.current?.awareness.setLocalStateField('cursor', null);
  }, []);

  const updateNote = (txId: string, note: string) =>
    setAnnotation(audit, txId, { note }, currentUser.name);
  const toggleFlag = (txId: string) => {
    const current = getAnnotation(audit, txId);
    setAnnotation(audit, txId, { flagged: !current?.flagged }, currentUser.name);
  };

  const flaggedCount = listAnnotations(audit).filter((a) => a.flagged).length;
  const collaboratorCount = peers.length + 1;

  return (
    <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-xl shadow-xl space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span>🧾</span> Collaborative Audit Workspace
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Annotate and flag ledger entries with your team in real time. Notes sync via CRDT, so
            concurrent edits never clobber each other.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={`text-xs font-mono px-2.5 py-1 rounded-lg border ${
              connected
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : 'bg-slate-800/50 text-slate-400 border-slate-700/50'
            }`}
            data-testid="collab-status"
          >
            {connected ? 'Live' : 'Offline'}
          </span>
          <div className="flex -space-x-2" data-testid="presence-avatars">
            {[
              { id: currentUser.id, name: `${currentUser.name} (you)`, color: localColor },
              ...peers
                .map((p) => p.user)
                .filter((u): u is AuditCollaborator & { color: string } => Boolean(u)),
            ].map((user, index) => (
              <span
                key={`${user.id}-${index}`}
                title={user.name}
                className="w-7 h-7 rounded-full border-2 border-slate-900 flex items-center justify-center text-[11px] font-bold text-slate-900"
                style={{ backgroundColor: user.color }}
              >
                {user.name.charAt(0).toUpperCase()}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <span className="px-2.5 py-1 rounded-md bg-slate-950/60 border border-slate-800 text-slate-300">
          {collaboratorCount} {collaboratorCount === 1 ? 'auditor' : 'auditors'} in room
        </span>
        <span className="px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-400">
          {flaggedCount} flagged
        </span>
      </div>

      <div
        ref={surfaceRef}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        className="relative rounded-xl bg-slate-950/40 border border-slate-800 overflow-hidden"
        data-testid="audit-surface"
      >
        {/* Remote collaborator cursors */}
        {peers.map((peer, index) =>
          peer.cursor && peer.user ? (
            <span
              key={`cursor-${peer.user.id}-${index}`}
              data-testid={`remote-cursor-${peer.user.id}`}
              className="pointer-events-none absolute z-20 -translate-x-1 -translate-y-1 transition-all duration-75"
              style={{ left: `${peer.cursor.x * 100}%`, top: `${peer.cursor.y * 100}%` }}
            >
              <span className="block w-3 h-3 rotate-45 rounded-sm" style={{ backgroundColor: peer.user.color }} />
              <span
                className="ml-3 -mt-2 px-1.5 py-0.5 rounded text-[10px] font-semibold text-slate-900 whitespace-nowrap"
                style={{ backgroundColor: peer.user.color }}
              >
                {peer.user.name}
              </span>
            </span>
          ) : null,
        )}

        {payments.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">
            No ledger entries to audit yet.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <th className="py-3 px-4">Transaction</th>
                <th className="py-3 px-4">Amount</th>
                <th className="py-3 px-4 w-1/2">Audit note</th>
                <th className="py-3 px-4">Flag</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {payments.map((payment) => {
                const annotation = getAnnotation(audit, payment.id);
                return (
                  <tr key={payment.id} className="align-top">
                    <td className="py-3 px-4 font-mono text-xs text-slate-400 whitespace-nowrap">
                      {payment.txHash ? `${payment.txHash.slice(0, 10)}…` : payment.id}
                    </td>
                    <td className="py-3 px-4 font-semibold text-emerald-400 whitespace-nowrap">
                      {Number(payment.amount).toLocaleString()} {payment.asset}
                    </td>
                    <td className="py-3 px-4">
                      <input
                        aria-label={`Audit note for ${payment.txHash || payment.id}`}
                        value={annotation?.note ?? ''}
                        onChange={(e) => updateNote(payment.id, e.target.value)}
                        placeholder="Add a note for your team…"
                        className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 placeholder-slate-600 text-sm focus:outline-none focus:border-cyan-500"
                      />
                      {annotation?.updatedBy && (
                        <p className="text-[11px] text-slate-500 mt-1">
                          last edited by {annotation.updatedBy}
                        </p>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <button
                        type="button"
                        aria-pressed={annotation?.flagged ?? false}
                        aria-label={`Flag transaction ${payment.txHash || payment.id}`}
                        onClick={() => toggleFlag(payment.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                          annotation?.flagged
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                            : 'bg-slate-800/50 text-slate-400 border-slate-700/50 hover:text-slate-200'
                        }`}
                      >
                        {annotation?.flagged ? '⚑ Flagged' : 'Flag'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default AuditWorkspace;
