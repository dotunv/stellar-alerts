import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandPalette, CommandGroup } from './CommandPalette';

function makeGroups(): CommandGroup[] {
  return [
    {
      id: 'navigation',
      label: 'Navigation',
      items: [
        { id: 'add-wallet', label: 'Add a wallet', keywords: ['watch'], onSelect: vi.fn() },
        { id: 'alert-settings', label: 'Alert settings', keywords: ['notification'], onSelect: vi.fn() },
      ],
    },
    {
      id: 'account',
      label: 'Account',
      items: [{ id: 'sign-out', label: 'Sign out', onSelect: vi.fn() }],
    },
  ];
}

describe('CommandPalette', () => {
  it('is closed by default and opens on Meta+K', () => {
    render(<CommandPalette groups={makeGroups()} />);

    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.getByTestId('command-palette')).toBeInTheDocument();
  });

  it('opens on Ctrl+K and closes with Escape', () => {
    render(<CommandPalette groups={makeGroups()} />);

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByTestId('command-palette')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();
  });

  it('navigates with arrow keys and triggers the active action on Enter', () => {
    const groups = makeGroups();
    render(<CommandPalette groups={groups} />);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    const input = screen.getByTestId('command-palette-input');
    const signOutSpy = groups[1].items[0].onSelect as ReturnType<typeof vi.fn>;

    // First item is already active; press ArrowDown twice to reach the third item ("Sign out").
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(signOutSpy).toHaveBeenCalledTimes(1);
  });

  it('filters items as the query changes', () => {
    render(<CommandPalette groups={makeGroups()} />);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    const input = screen.getByTestId('command-palette-input');
    fireEvent.change(input, { target: { value: 'sign' } });

    expect(screen.getByTestId('command-item-sign-out')).toBeInTheDocument();
    expect(screen.queryByTestId('command-item-add-wallet')).not.toBeInTheDocument();
    expect(screen.queryByTestId('command-item-alert-settings')).not.toBeInTheDocument();
  });

  it('closes the palette after running an action', () => {
    render(<CommandPalette groups={makeGroups()} />);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    const input = screen.getByTestId('command-palette-input');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();
  });
});
