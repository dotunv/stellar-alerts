import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PaymentDTO } from '@stellar-alerts/shared';

// Replace the network provider with an in-memory stub that still exercises the
// real y-protocols Awareness so presence logic is covered.
vi.mock('y-websocket', async () => {
  const { Awareness } = await import('y-protocols/awareness');
  class FakeWebsocketProvider {
    awareness: InstanceType<typeof Awareness>;
    private listeners: Record<string, ((...args: any[]) => void)[]> = {};
    constructor(_url: string, _room: string, doc: any) {
      this.awareness = new Awareness(doc);
    }
    on(event: string, cb: (...args: any[]) => void) {
      (this.listeners[event] ||= []).push(cb);
    }
    off(event: string, cb: (...args: any[]) => void) {
      this.listeners[event] = (this.listeners[event] || []).filter((l) => l !== cb);
    }
    destroy() {
      this.awareness.destroy();
    }
  }
  return { WebsocketProvider: FakeWebsocketProvider };
});

import { AuditWorkspace } from './AuditWorkspace';
import {
  createAuditDoc,
  setAnnotation,
  getAnnotation,
  listAnnotations,
  connectAuditDocs,
} from './auditWorkspace.crdt';

const payment = (over: Partial<PaymentDTO> = {}): PaymentDTO => ({
  id: 'p1',
  walletId: 'w1',
  txHash: 'abcdef1234567890',
  fromAddress: 'GSENDER',
  amount: 100,
  asset: 'XLM',
  receivedAt: new Date().toISOString(),
  ...over,
});

describe('auditWorkspace.crdt — Yjs state sync', () => {
  it('converges two docs that annotated the same transaction concurrently (different fields)', () => {
    const alice = createAuditDoc();
    const bob = createAuditDoc();
    const disconnect = connectAuditDocs(alice, bob);

    // Concurrent edits to the SAME tx but DIFFERENT fields must both survive.
    setAnnotation(alice, 'tx-1', { note: 'looks like payroll' }, 'Alice', 1000);
    setAnnotation(bob, 'tx-1', { flagged: true }, 'Bob', 1001);

    const fromAlice = getAnnotation(alice, 'tx-1');
    const fromBob = getAnnotation(bob, 'tx-1');
    expect(fromAlice).toEqual(fromBob);
    expect(fromAlice?.note).toBe('looks like payroll');
    expect(fromAlice?.flagged).toBe(true);

    disconnect();
  });

  it('resolves a concurrent write to the same field deterministically on both docs', () => {
    const alice = createAuditDoc();
    const bob = createAuditDoc();

    // Diverge BEFORE connecting: both set the same field to different values.
    setAnnotation(alice, 'tx-9', { note: 'A version' }, 'Alice', 5000);
    setAnnotation(bob, 'tx-9', { note: 'B version' }, 'Bob', 5001);

    const disconnect = connectAuditDocs(alice, bob);

    const a = getAnnotation(alice, 'tx-9');
    const b = getAnnotation(bob, 'tx-9');
    // Yjs Map is last-writer-wins per field: both docs MUST agree on the winner.
    expect(a).toEqual(b);
    expect(['A version', 'B version']).toContain(a?.note);

    disconnect();
  });

  it('merges annotations for distinct transactions from both peers', () => {
    const alice = createAuditDoc();
    const bob = createAuditDoc();
    const disconnect = connectAuditDocs(alice, bob);

    setAnnotation(alice, 'tx-a', { note: 'from alice', flagged: true }, 'Alice', 10);
    setAnnotation(bob, 'tx-b', { note: 'from bob' }, 'Bob', 20);

    for (const doc of [alice, bob]) {
      const ids = listAnnotations(doc).map((r) => r.txId).sort();
      expect(ids).toEqual(['tx-a', 'tx-b']);
    }
    // listAnnotations is newest-first.
    expect(listAnnotations(bob)[0].txId).toBe('tx-b');

    disconnect();
  });

  it('a peer that joins late still receives the full annotation history', () => {
    const alice = createAuditDoc();
    setAnnotation(alice, 'tx-1', { note: 'early note' }, 'Alice', 1);
    setAnnotation(alice, 'tx-2', { flagged: true }, 'Alice', 2);

    const latecomer = createAuditDoc();
    const disconnect = connectAuditDocs(alice, latecomer);

    expect(listAnnotations(latecomer)).toHaveLength(2);
    expect(getAnnotation(latecomer, 'tx-1')?.note).toBe('early note');
    expect(getAnnotation(latecomer, 'tx-2')?.flagged).toBe(true);

    disconnect();
  });
});

describe('<AuditWorkspace />', () => {
  const user = { id: 'u-alice', name: 'Alice' };

  it('renders a row per payment with an editable note and the local presence avatar', () => {
    render(<AuditWorkspace payments={[payment({ id: 'p1' }), payment({ id: 'p2' })]} currentUser={user} />);

    expect(screen.getByText(/2 auditors in room|1 auditor in room/)).toBeInTheDocument();
    expect(screen.getByTestId('presence-avatars')).toHaveTextContent('A');
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    expect(screen.getByTestId('collab-status')).toHaveTextContent('Offline');
  });

  it('writes a typed note into the CRDT and shows the editor attribution', async () => {
    const typist = userEvent.setup();
    render(<AuditWorkspace payments={[payment({ id: 'p1', txHash: 'deadbeefcafe' })]} currentUser={user} />);

    const input = screen.getByLabelText(/Audit note for deadbeefcafe/i);
    await typist.type(input, 'refund to customer');

    expect(input).toHaveValue('refund to customer');
    expect(screen.getByText(/last edited by Alice/i)).toBeInTheDocument();
  });

  it('toggles the flag state and updates the flagged counter', async () => {
    const typist = userEvent.setup();
    render(<AuditWorkspace payments={[payment({ id: 'p1' })]} currentUser={user} />);

    const flagButton = screen.getByRole('button', { name: /Flag transaction/i });
    expect(flagButton).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('0 flagged')).toBeInTheDocument();

    await typist.click(flagButton);

    expect(flagButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('1 flagged')).toBeInTheDocument();
  });

  it('shows the empty state when there are no payments', () => {
    render(<AuditWorkspace payments={[]} currentUser={user} />);
    expect(screen.getByText(/No ledger entries to audit yet/i)).toBeInTheDocument();
  });
});
