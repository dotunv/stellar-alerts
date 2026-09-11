'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface CommandItem {
  id: string;
  label: string;
  keywords?: string[];
  shortcut?: string;
  icon?: React.ReactNode;
  onSelect: () => void;
}

export interface CommandGroup {
  id: string;
  label: string;
  items: CommandItem[];
}

interface CommandPaletteProps {
  groups: CommandGroup[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  placeholder?: string;
  emptyMessage?: string;
  enableScrollLock?: boolean;
}

function matchesQuery(item: CommandItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [item.label, ...(item.keywords ?? [])]
    .map((part) => part.toLowerCase())
    .join(' ');
  return haystack.includes(q);
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  groups,
  open: controlledOpen,
  onOpenChange,
  placeholder = 'Type a command or search…',
  emptyMessage = 'No matching commands found.',
  enableScrollLock = true,
}) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const isOpen = controlledOpen ?? internalOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange]
  );

  const flattened = useMemo(() => {
    const items: { item: CommandItem; groupId: string; groupLabel: string }[] = [];
    groups.forEach((group) => {
      group.items.forEach((item) => {
        if (matchesQuery(item, query)) {
          items.push({ item, groupId: group.id, groupLabel: group.label });
        }
      });
    });
    return items;
  }, [groups, query]);

  const reset = useCallback(() => {
    setQuery('');
    setActiveIndex(0);
  }, []);

  const openPalette = useCallback(() => {
    reset();
    setOpen(true);
  }, [reset, setOpen]);

  const closePalette = useCallback(() => {
    setOpen(false);
    reset();
  }, [reset, setOpen]);

  const runItem = useCallback(
    (index: number) => {
      const target = flattened[index];
      if (!target) return;
      closePalette();
      target.item.onSelect();
    },
    [flattened, closePalette]
  );

  // Global keybinding: Cmd/Ctrl+K toggles the palette; Esc closes it.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const modifier = e.metaKey || e.ctrlKey;
      if (modifier && (e.key.toLowerCase() === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (isOpen) {
          closePalette();
        } else {
          openPalette();
        }
      } else if (e.key === 'Escape' && isOpen) {
        closePalette();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, openPalette, closePalette]);

  // Refocus the search input whenever the palette reopens.
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  // Keep the highlight valid when filtered results shrink.
  const boundedActiveIndex = flattened.length === 0
    ? 0
    : Math.min(activeIndex, flattened.length - 1);

  // Lock background scroll while the palette is open.
  useEffect(() => {
    if (!enableScrollLock || !isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, enableScrollLock]);

  function handleListKeyDown(e: React.KeyboardEvent) {
    if (flattened.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % flattened.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + flattened.length) % flattened.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runItem(boundedActiveIndex);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % flattened.length);
    }
  }

  useEffect(() => {
    const activeEl = listRef.current?.querySelector<HTMLElement>(
      '[data-active-item="true"]'
    );
    activeEl?.scrollIntoView?.({ block: 'nearest' });
  }, [boundedActiveIndex]);

  if (!isOpen) return null;

  const visibleItems = flattened;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]">
      <div
        className="fixed inset-0 bg-[#030308]/80 backdrop-blur-md"
        onClick={closePalette}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-testid="command-palette"
        className="relative w-full max-w-xl rounded-2xl border border-white/10 bg-[#0c0c16]/95 shadow-[0_0_60px_rgba(6,182,212,0.15)] overflow-hidden"
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3.5">
          <svg
            className="w-5 h-5 text-cyan-400 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z"
            />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleListKeyDown}
            placeholder={placeholder}
            data-testid="command-palette-input"
            className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-2 py-1 rounded-md bg-white/5 border border-white/10 text-[10px] font-mono text-gray-400">
            esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2" role="listbox">
          {visibleItems.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-gray-500" data-testid="command-palette-empty">
              {emptyMessage}
            </p>
          ) : (
            groups.map((group) => {
              const groupItems = visibleItems.filter((v) => v.groupId === group.id);
              if (groupItems.length === 0) return null;
              return (
                <div key={group.id} className="mb-1">
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-500">
                    {group.label}
                  </div>
                  {groupItems.map((entry) => {
                    const itemIndex = visibleItems.indexOf(entry);
                    const isActive = itemIndex === activeIndex;
                    return (
                      <button
                        key={entry.item.id}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        data-active-item={isActive}
                        data-testid={`command-item-${entry.item.id}`}
                        onMouseEnter={() => setActiveIndex(itemIndex)}
                        onClick={() => runItem(itemIndex)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm transition-colors ${
                          isActive
                            ? 'bg-cyan-500/15 text-white border border-cyan-500/30'
                            : 'text-gray-300 border border-transparent'
                        }`}
                      >
                        {entry.item.icon && (
                          <span
                            className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
                              isActive
                                ? 'bg-cyan-500/20 text-cyan-300'
                                : 'bg-white/5 text-gray-400'
                            }`}
                          >
                            {entry.item.icon}
                          </span>
                        )}
                        <span className="flex-1 truncate">{entry.item.label}</span>
                        {entry.item.shortcut && (
                          <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] font-mono text-gray-400">
                            {entry.item.shortcut}
                          </kbd>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-white/10 px-4 py-2 text-[10px] text-gray-500">
          <span className="flex items-center gap-3">
            <span>
              <kbd className="font-mono">↑</kbd> <kbd className="font-mono">↓</kbd> navigate
            </span>
            <span>
              <kbd className="font-mono">↵</kbd> select
            </span>
          </span>
          <span>
            <kbd className="font-mono">⌘K</kbd> toggle
          </span>
        </div>
      </div>
    </div>
  );
};
