'use client';

import React, { useMemo, useState } from 'react';

export interface ActivityHeatmapPayment {
  receivedAt?: string | Date | null;
  createdAt?: string | Date | null;
}

export interface ActivityHeatmapDay {
  date: string;
  count: number;
}

interface ActivityHeatmapProps {
  payments?: ActivityHeatmapPayment[];
  referenceDate?: Date;
  days?: number;
}

const DEFAULT_DAYS = 365;
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CELL_SIZE = 12;
const CELL_GAP = 3;

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parsePaymentDate(payment: ActivityHeatmapPayment): Date | null {
  const value = payment.receivedAt ?? payment.createdAt;
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : startOfUtcDay(date);
}

export function buildActivityHeatmapData(
  payments: ActivityHeatmapPayment[] = [],
  referenceDate: Date = new Date(),
  days = DEFAULT_DAYS
): ActivityHeatmapDay[] {
  const count = Math.max(1, Math.floor(days));
  const end = startOfUtcDay(referenceDate);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - count + 1);
  const buckets = new Map<string, number>();

  for (let offset = 0; offset < count; offset += 1) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + offset);
    buckets.set(toDateKey(day), 0);
  }

  payments.forEach((payment) => {
    const date = parsePaymentDate(payment);
    if (!date) return;
    const key = toDateKey(date);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  });

  return Array.from(buckets, ([date, dayCount]) => ({ date, count: dayCount }));
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function getLevel(count: number, maximum: number): number {
  if (count === 0 || maximum === 0) return 0;
  if (count === maximum) return 4;
  if (count / maximum >= 0.75) return 3;
  if (count / maximum >= 0.5) return 2;
  return 1;
}

export const ActivityHeatmap: React.FC<ActivityHeatmapProps> = ({
  payments = [],
  referenceDate,
  days = DEFAULT_DAYS,
}) => {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const data = useMemo(
    () => buildActivityHeatmapData(payments, referenceDate, days),
    [days, payments, referenceDate]
  );
  const maximum = Math.max(...data.map((day) => day.count), 0);
  const selectedDay = data.find((day) => day.date === selectedDate) ?? data[data.length - 1];
  const startDate = new Date(`${data[0].date}T00:00:00.000Z`);
  const leadingEmptyCells = startDate.getUTCDay();
  const cells = [...Array(leadingEmptyCells).fill(null), ...data];
  const columnCount = Math.ceil(cells.length / 7);

  return (
    <section
      className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-xl shadow-xl mb-8"
      aria-labelledby="activity-heatmap-title"
    >
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div>
          <h2 id="activity-heatmap-title" className="text-xl font-bold text-white flex items-center gap-2">
            <span aria-hidden="true">▦</span> Activity
          </h2>
          <p className="text-sm text-slate-400 mt-1">Daily transaction activity over the past year.</p>
        </div>
        <div className="rounded-xl bg-slate-950/50 border border-slate-800/80 px-4 py-3 min-w-36">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected day</div>
          <div className="text-sm font-mono text-emerald-300 mt-1">{formatDate(selectedDay.date)}</div>
          <div className="text-xs text-slate-400 mt-1">
            {selectedDay.count} {selectedDay.count === 1 ? 'transaction' : 'transactions'}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto pb-2" data-testid="activity-heatmap-scroll-container">
        <div className="min-w-[760px]">
          <div className="flex" style={{ gap: CELL_GAP }}>
            <div className="w-8 shrink-0 pt-1" aria-hidden="true">
              {WEEKDAY_LABELS.map((label, index) => (
                <div key={label} className="h-[15px] mb-[3px] text-[10px] leading-[12px] text-slate-500">
                  {index % 2 === 1 ? label : ''}
                </div>
              ))}
            </div>
            <div>
              <div
                className="grid h-4 mb-1 text-[10px] text-slate-500"
                style={{ gridTemplateColumns: `repeat(${columnCount}, ${CELL_SIZE}px)`, gap: CELL_GAP }}
                aria-hidden="true"
              >
                {Array.from({ length: columnCount }, (_, index) => {
                  const date = data[index * 7];
                  const month = date ? date.date.slice(0, 7) : '';
                  const previous = index > 0 ? data[(index - 1) * 7]?.date.slice(0, 7) : '';
                  return <span key={`${month}-${index}`}>{month !== previous ? month.slice(5) : ''}</span>;
                })}
              </div>
              <div
                data-testid="activity-heatmap-grid"
                className="grid grid-rows-7"
                style={{ gridAutoFlow: 'column', gridTemplateRows: 'repeat(7, 12px)', gridAutoColumns: `${CELL_SIZE}px`, gap: CELL_GAP }}
                role="group"
                aria-label={`${data.length}-day transaction activity heatmap`}
              >
                {cells.map((day, index) => {
                  if (!day) return <span key={`empty-${index}`} aria-hidden="true" />;
                  const level = getLevel(day.count, maximum);
                  return (
                    <button
                      key={day.date}
                      type="button"
                      aria-label={`${formatDate(day.date)}: ${day.count} ${day.count === 1 ? 'transaction' : 'transactions'}`}
                      data-testid={`activity-heatmap-day-${day.date}`}
                      data-level={level}
                      onMouseEnter={() => setSelectedDate(day.date)}
                      onFocus={() => setSelectedDate(day.date)}
                      className={`w-3 h-3 rounded-[3px] border transition-transform hover:scale-125 focus:outline-none focus:ring-2 focus:ring-emerald-300/80 ${
                        level === 0 ? 'bg-slate-800/80 border-slate-700' :
                        level === 1 ? 'bg-emerald-950 border-emerald-900' :
                        level === 2 ? 'bg-emerald-700 border-emerald-600' :
                        level === 3 ? 'bg-emerald-500 border-emerald-400' :
                        'bg-emerald-300 border-emerald-200'
                      }`}
                    >
                      <span className="sr-only">{formatDate(day.date)}: {day.count} transactions</span>
                      <span role="tooltip" className="pointer-events-none absolute z-10 hidden whitespace-nowrap rounded-md bg-slate-950 px-2 py-1 text-[11px] text-white shadow-lg group-hover:block">
                        {formatDate(day.date)}: {day.count} {day.count === 1 ? 'transaction' : 'transactions'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 mt-4 text-xs text-slate-500">
        <span>{data.length} days</span>
        <div className="flex items-center gap-1.5" aria-label="Activity intensity legend">
          <span>Less</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <span
              key={level}
              data-testid={`activity-heatmap-legend-${level}`}
              className={`w-3 h-3 rounded-[3px] border ${
                level === 0 ? 'bg-slate-800/80 border-slate-700' :
                level === 1 ? 'bg-emerald-950 border-emerald-900' :
                level === 2 ? 'bg-emerald-700 border-emerald-600' :
                level === 3 ? 'bg-emerald-500 border-emerald-400' :
                'bg-emerald-300 border-emerald-200'
              }`}
            />
          ))}
          <span>More</span>
        </div>
      </div>
    </section>
  );
};
