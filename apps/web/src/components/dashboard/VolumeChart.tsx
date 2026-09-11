'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  CURRENCY_OPTIONS,
  CurrencyCode,
  FALLBACK_XLM_RATES,
  convertXlmAmount,
  fetchXlmFiatRates,
  formatCurrencyAmount,
} from './currency';

export interface VolumeChartPayment {
  amount: string | number;
  asset?: string | null;
  receivedAt?: string | Date | null;
  createdAt?: string | Date | null;
}

export interface VolumePoint {
  date: string;
  volumeXLM: number;
}

interface VolumeChartProps {
  payments?: VolumeChartPayment[];
  totalVolumeXLM?: number;
  rates?: Partial<Record<CurrencyCode, number>>;
  referenceDate?: Date;
}

const CHART_WIDTH = 720;
const CHART_HEIGHT = 260;
const CHART_PADDING = 32;

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function buildThirtyDayVolumeSeries(
  payments: VolumeChartPayment[] = [],
  referenceDate: Date = new Date()
): VolumePoint[] {
  const end = startOfUtcDay(referenceDate);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);

  const buckets = new Map<string, number>();
  for (let offset = 0; offset < 30; offset += 1) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + offset);
    buckets.set(toDateKey(day), 0);
  }

  payments.forEach((payment) => {
    const asset = (payment.asset ?? 'XLM').toUpperCase();
    if (asset !== 'XLM') return;

    const paymentDateValue = payment.receivedAt ?? payment.createdAt;
    if (!paymentDateValue) return;

    const paymentDate =
      paymentDateValue instanceof Date ? paymentDateValue : new Date(paymentDateValue);
    if (Number.isNaN(paymentDate.getTime())) return;

    const normalizedDay = startOfUtcDay(paymentDate);
    const key = toDateKey(normalizedDay);
    if (!buckets.has(key)) return;

    const amount = Number(payment.amount);
    if (!Number.isFinite(amount)) return;
    buckets.set(key, (buckets.get(key) ?? 0) + amount);
  });

  return Array.from(buckets.entries()).map(([date, volumeXLM]) => ({
    date,
    volumeXLM: Math.round(volumeXLM * 100) / 100,
  }));
}

export function spreadTotalVolumeAcrossSeries(
  totalVolumeXLM: number,
  referenceDate: Date = new Date()
): VolumePoint[] {
  const emptySeries = buildThirtyDayVolumeSeries([], referenceDate);
  if (!Number.isFinite(totalVolumeXLM) || totalVolumeXLM <= 0) {
    return emptySeries;
  }

  const dailyAverage = totalVolumeXLM / emptySeries.length;
  return emptySeries.map((point, index) => ({
    ...point,
    volumeXLM: Math.round(dailyAverage * (0.75 + (index % 6) * 0.1) * 100) / 100,
  }));
}

export const VolumeChart: React.FC<VolumeChartProps> = ({
  payments = [],
  totalVolumeXLM = 0,
  rates,
  referenceDate,
}) => {
  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyCode>('XLM');
  const [liveRates, setLiveRates] = useState<Record<CurrencyCode, number>>(FALLBACK_XLM_RATES);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (rates) return () => {
      isMounted = false;
    };

    fetchXlmFiatRates()
      .then((nextRates) => {
        if (isMounted) setLiveRates(nextRates);
      })
      .catch(() => {
        if (isMounted) setLiveRates(FALLBACK_XLM_RATES);
      });

    return () => {
      isMounted = false;
    };
  }, [rates]);

  const resolvedRates = useMemo(
    () => ({
      ...FALLBACK_XLM_RATES,
      ...liveRates,
      ...rates,
    }),
    [liveRates, rates]
  );

  const series = useMemo(() => {
    const thirtyDaySeries = buildThirtyDayVolumeSeries(payments, referenceDate);
    const hasRecordedVolume = thirtyDaySeries.some((point) => point.volumeXLM > 0);
    return hasRecordedVolume
      ? thirtyDaySeries
      : spreadTotalVolumeAcrossSeries(totalVolumeXLM, referenceDate);
  }, [payments, referenceDate, totalVolumeXLM]);

  const convertedSeries = useMemo(
    () =>
      series.map((point) => ({
        ...point,
        value: convertXlmAmount(point.volumeXLM, selectedCurrency, resolvedRates),
      })),
    [resolvedRates, selectedCurrency, series]
  );

  const maxValue = Math.max(...convertedSeries.map((point) => point.value), 1);
  const drawableWidth = CHART_WIDTH - CHART_PADDING * 2;
  const drawableHeight = CHART_HEIGHT - CHART_PADDING * 2;
  const hoveredPoint = convertedSeries[hoveredIndex ?? convertedSeries.length - 1];

  const coordinates = convertedSeries.map((point, index) => {
    const x = CHART_PADDING + (drawableWidth / Math.max(convertedSeries.length - 1, 1)) * index;
    const y = CHART_HEIGHT - CHART_PADDING - (point.value / maxValue) * drawableHeight;
    return { ...point, x, y };
  });

  const linePath = coordinates
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');

  const areaPath =
    `${linePath} L ${CHART_WIDTH - CHART_PADDING} ${CHART_HEIGHT - CHART_PADDING} ` +
    `L ${CHART_PADDING} ${CHART_HEIGHT - CHART_PADDING} Z`;

  return (
    <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-xl shadow-xl mb-8">
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span>????</span> 30-Day Volume
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            XLM payment volume converted into the selected display currency.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2" aria-label="Select chart currency">
          {CURRENCY_OPTIONS.map((option) => (
            <button
              key={option.code}
              type="button"
              data-testid={`volume-currency-toggle-${option.code}`}
              onClick={() => setSelectedCurrency(option.code)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                selectedCurrency === option.code
                  ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-100'
                  : 'bg-slate-950/40 border-slate-700/80 text-slate-400 hover:text-slate-200 hover:border-slate-500'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-6 items-stretch">
        <div className="rounded-xl bg-slate-950/50 border border-slate-800/80 p-4 overflow-hidden">
          <svg
            data-testid="volume-chart-svg"
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            role="img"
            aria-label="Thirty day payment volume chart"
            className="w-full h-auto"
          >
            <defs>
              <linearGradient id="volume-chart-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.32" />
                <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <line
              x1={CHART_PADDING}
              y1={CHART_HEIGHT - CHART_PADDING}
              x2={CHART_WIDTH - CHART_PADDING}
              y2={CHART_HEIGHT - CHART_PADDING}
              stroke="#334155"
              strokeWidth="1"
            />
            <path d={areaPath} fill="url(#volume-chart-fill)" />
            <path d={linePath} fill="none" stroke="#22d3ee" strokeWidth="4" strokeLinecap="round" />
            {coordinates.map((point, index) => (
              <circle
                key={point.date}
                cx={point.x}
                cy={point.y}
                r={hoveredIndex === index ? 7 : 4}
                fill={hoveredIndex === index ? '#f8fafc' : '#22d3ee'}
                stroke="#0891b2"
                strokeWidth="2"
                tabIndex={0}
                onMouseEnter={() => setHoveredIndex(index)}
                onFocus={() => setHoveredIndex(index)}
                data-testid={`volume-chart-point-${index}`}
              >
                <title>
                  {point.date}: {formatCurrencyAmount(point.value, selectedCurrency)}
                </title>
              </circle>
            ))}
          </svg>
        </div>

        <div className="rounded-xl bg-slate-950/50 border border-slate-800/80 p-4 flex flex-col justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Selected Day
            </div>
            <div className="text-sm font-mono text-cyan-300 mt-1">{hoveredPoint?.date}</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Volume
            </div>
            <div className="text-2xl font-bold text-white mt-1">
              {formatCurrencyAmount(hoveredPoint?.value ?? 0, selectedCurrency)}
            </div>
            {selectedCurrency !== 'XLM' && (
              <div className="text-xs text-slate-500 mt-1">
                {(hoveredPoint?.volumeXLM ?? 0).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                XLM
              </div>
            )}
          </div>
          <div className="text-xs text-slate-400 leading-relaxed">
            {payments.length > 0
              ? `${payments.length} payment records included in this window.`
              : 'Showing projected distribution until recorded payments are available.'}
          </div>
        </div>
      </div>
    </div>
  );
};