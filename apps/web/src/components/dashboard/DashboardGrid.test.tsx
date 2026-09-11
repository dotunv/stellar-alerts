import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DashboardGrid, DashboardWidgetItem } from './DashboardGrid';

function makeDataTransfer() {
  const data = new Map<string, string>();
  return {
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    effectAllowed: 'move',
    dropEffect: 'none',
  };
}

const items: DashboardWidgetItem[] = [
  { id: 'summary', label: 'Summary Overview', content: <div>Summary Content</div> },
  { id: 'wallets', label: 'Wallets', content: <div>Wallets Content</div> },
  { id: 'payments', label: 'Payments', content: <div>Payments Content</div> },
];

describe('DashboardGrid', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders all widgets in their defined order by default', () => {
    render(<DashboardGrid items={items} />);

    const labels = screen
      .getAllByTestId(/dashboard-widget-handle-/)
      .map((el) => el.textContent ?? '');

    expect(screen.getByTestId('dashboard-widget-summary')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-widget-wallets')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-widget-payments')).toBeInTheDocument();
    expect(labels[0]).toContain('Summary Overview');
    expect(labels[1]).toContain('Wallets');
    expect(labels[2]).toContain('Payments');
  });

  it('reorders widgets when a card header is dragged and dropped', () => {
    render(<DashboardGrid items={items} />);

    const firstHandle = screen.getByTestId('dashboard-widget-handle-summary');
    const lastSection = screen.getByTestId('dashboard-widget-payments');
    const dt = makeDataTransfer();

    fireEvent.dragStart(firstHandle, { dataTransfer: dt });
    fireEvent.dragOver(lastSection, { dataTransfer: dt });
    fireEvent.drop(lastSection, { dataTransfer: dt });
    fireEvent.dragEnd(firstHandle, { dataTransfer: dt });

    const labels = screen
      .getAllByTestId(/dashboard-widget-handle-/)
      .map((el) => el.textContent ?? '');

    expect(labels[0]).toContain('Wallets');
    expect(labels[1]).toContain('Payments');
    expect(labels[2]).toContain('Summary Overview');
  });

  it('persists the custom order to localStorage', () => {
    const storageKey = 'test-dashboard-order';
    const { unmount } = render(<DashboardGrid items={items} storageKey={storageKey} />);

    const firstHandle = screen.getByTestId('dashboard-widget-handle-summary');
    const lastSection = screen.getByTestId('dashboard-widget-payments');
    const dt = makeDataTransfer();

    fireEvent.dragStart(firstHandle, { dataTransfer: dt });
    fireEvent.drop(lastSection, { dataTransfer: dt });
    fireEvent.dragEnd(firstHandle, { dataTransfer: dt });

    const persisted = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]');
    expect(persisted).toEqual(['wallets', 'payments', 'summary']);
    unmount();
  });

  it('restores a previously saved order on mount', () => {
    const storageKey = 'test-dashboard-order';
    window.localStorage.setItem(storageKey, JSON.stringify(['payments', 'summary', 'wallets']));

    render(<DashboardGrid items={items} storageKey={storageKey} />);

    const labels = screen
      .getAllByTestId(/dashboard-widget-handle-/)
      .map((el) => el.textContent ?? '');

    expect(labels[0]).toContain('Payments');
    expect(labels[1]).toContain('Summary Overview');
    expect(labels[2]).toContain('Wallets');
  });
});
