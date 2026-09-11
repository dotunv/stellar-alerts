'use client';

import React, { useState, useEffect } from 'react';

export interface DashboardWidgetItem {
  id: string;
  label: string;
  content: React.ReactNode;
}

interface DashboardGridProps {
  items: DashboardWidgetItem[];
  storageKey?: string;
}

const DEFAULT_STORAGE_KEY = 'stellar-alerts:dashboard-order';

function readStoredOrder(storageKey: string, itemIds: string[]): string[] {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return itemIds;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return itemIds;
    const known = parsed.filter((id): id is string => typeof id === 'string' && itemIds.includes(id));
    const missing = itemIds.filter((id) => !known.includes(id));
    return [...known, ...missing];
  } catch {
    return itemIds;
  }
}

export const DashboardGrid: React.FC<DashboardGridProps> = ({
  items,
  storageKey = DEFAULT_STORAGE_KEY,
}) => {
  const itemIds = items.map((item) => item.id);

  const [order, setOrder] = useState<string[]>(() =>
    typeof window === 'undefined' ? itemIds : readStoredOrder(storageKey, itemIds)
  );
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(order));
    } catch {
      // Ignore persistence failures (e.g. private browsing / storage quotas)
    }
  }, [order, storageKey]);

  const orderedItems = order
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is DashboardWidgetItem => Boolean(item));

  const handleDragStart =
    (index: number) =>
    (e: React.DragEvent<HTMLElement>) => {
      e.dataTransfer.setData('text/plain', String(index));
      e.dataTransfer.effectAllowed = 'move';
      setDragIndex(index);
    };

  const handleDragOver =
    (index: number) =>
    (e: React.DragEvent<HTMLElement>) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (index !== overIndex) setOverIndex(index);
    };

  const handleDrop =
    (index: number) =>
    (e: React.DragEvent<HTMLElement>) => {
      e.preventDefault();
      const sourceIndex = Number(e.dataTransfer.getData('text/plain'));
      if (Number.isNaN(sourceIndex) || sourceIndex === index) {
        setDragIndex(null);
        setOverIndex(null);
        return;
      }
      setOrder((prev) => {
        const next = [...prev];
        const [moved] = next.splice(sourceIndex, 1);
        next.splice(index, 0, moved);
        return next;
      });
      setDragIndex(null);
      setOverIndex(null);
    };

  const handleDragEnd = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  return (
    <div>
      {orderedItems.map((item, index) => (
        <section
          key={item.id}
          data-testid={`dashboard-widget-${item.id}`}
          draggable
          onDragStart={handleDragStart(index)}
          onDragOver={handleDragOver(index)}
          onDrop={handleDrop(index)}
          onDragEnd={handleDragEnd}
          className={`transition-opacity duration-150 ${
            dragIndex === index ? 'opacity-50' : ''
          }`}
        >
          <div
            data-testid={`dashboard-widget-handle-${item.id}`}
            className={`flex items-center gap-2 mb-3 px-2 py-1 rounded-lg cursor-grab active:cursor-grabbing select-none group transition-colors ${
              overIndex === index ? 'ring-2 ring-cyan-500/60 bg-cyan-500/5' : 'hover:bg-white/5'
            }`}
            title="Drag to reorder dashboard widget"
          >
            <span className="text-slate-500 group-hover:text-cyan-400 transition-colors" aria-hidden="true">
              ⠿
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 group-hover:text-slate-300 transition-colors">
              {item.label}
            </span>
          </div>
          {item.content}
        </section>
      ))}
    </div>
  );
};
