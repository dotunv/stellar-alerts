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

export interface CrossLedgerAnalyticsSummary {
  totalVolume: number;
  totalTransactionCount: number;
  averagePaymentSize: number;
  breakdown: {
    classic: { volume: number; count: number; averageSize: number };
    soroban: { volume: number; count: number; averageSize: number };
  };
}

export interface CrossLedgerAnalyticsData {
  summary: CrossLedgerAnalyticsSummary;
  daily?: Array<{
    date: string;
    totalVolume: number;
    totalCount: number;
    averagePaymentSize: number;
    classicVolume: number;
    classicCount: number;
    sorobanVolume: number;
    sorobanCount: number;
  }>;
}

interface SummaryStatsProps {
  totalPaymentsCount: number;
  totalVolumeXLM: number;
  activeWalletsCount: number;
  rates?: Partial<Record<CurrencyCode, number>>;
  crossLedgerAnalytics?: CrossLedgerAnalyticsData;
}

export const SummaryStats: React.FC<SummaryStatsProps> = ({
  totalPaymentsCount,
  totalVolumeXLM,
  activeWalletsCount,
  rates,
  crossLedgerAnalytics,
}) => {
  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyCode>('XLM');
  const [liveRates, setLiveRates] = useState<Record<CurrencyCode, number>>(FALLBACK_XLM_RATES);
  const [rateStatus, setRateStatus] = useState<'loading' | 'live' | 'fallback'>('loading');

  useEffect(() => {
    let isMounted = true;

    if (rates) {
      return () => {
        isMounted = false;
      };
    }

    fetchXlmFiatRates()
      .then((nextRates) => {
        if (!isMounted) return;
        setLiveRates(nextRates);
        setRateStatus('live');
      })
      .catch(() => {
        if (!isMounted) return;
        setRateStatus('fallback');
      });

    return () => {
      isMounted = false;
    };
  }, [rates]);

  const resolvedRateStatus = rates ? 'live' : rateStatus;

  const resolvedRates = useMemo(
    () => ({
      ...FALLBACK_XLM_RATES,
      ...liveRates,
      ...rates,
    }),
    [liveRates, rates]
  );

  const effectiveTotalVolume = crossLedgerAnalytics?.summary?.totalVolume ?? totalVolumeXLM;
  const effectiveTotalCount = crossLedgerAnalytics?.summary?.totalTransactionCount ?? totalPaymentsCount;
  const effectiveAverageSize =
    crossLedgerAnalytics?.summary?.averagePaymentSize ??
    (effectiveTotalCount > 0 ? effectiveTotalVolume / effectiveTotalCount : 0);

  const convertedVolume = convertXlmAmount(effectiveTotalVolume, selectedCurrency, resolvedRates);
  const showConvertedFiat = selectedCurrency !== 'XLM';

  const classicBreakdown = crossLedgerAnalytics?.summary?.breakdown?.classic;
  const sorobanBreakdown = crossLedgerAnalytics?.summary?.breakdown?.soroban;

  return (
    <div className="space-y-6 mb-8">
      {/* Primary Cross-Ledger Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Total Cross-Ledger Volume */}
        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-xl shadow-xl hover:border-purple-500/30 transition-all duration-300">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Cross-Ledger Volume
              </span>
              <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Select display currency">
                {CURRENCY_OPTIONS.map((option) => (
                  <button
                    key={option.code}
                    type="button"
                    data-testid={`currency-toggle-${option.code}`}
                    onClick={() => setSelectedCurrency(option.code)}
                    className={`px-2 py-0.5 rounded-md border text-[10px] font-bold transition-colors ${
                      selectedCurrency === option.code
                        ? 'bg-purple-500/20 border-purple-400/60 text-purple-100'
                        : 'bg-slate-950/40 border-slate-700/80 text-slate-400 hover:text-slate-200 hover:border-slate-500'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <span className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20 shrink-0">
              ⚡
            </span>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl lg:text-3xl font-extrabold tracking-tight text-white">
                {formatCurrencyAmount(convertedVolume, selectedCurrency)}
              </span>
            </div>
            {showConvertedFiat && (
              <span className="text-xs font-medium text-slate-500">
                {effectiveTotalVolume.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                XLM at {resolvedRates[selectedCurrency].toFixed(4)} {selectedCurrency}/XLM
              </span>
            )}
            <span
              className={`mt-2 inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                resolvedRateStatus === 'live'
                  ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                  : resolvedRateStatus === 'loading'
                    ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/20'
                    : 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
              }`}
            >
              {resolvedRateStatus === 'live' ? 'Live rates' : resolvedRateStatus === 'loading' ? 'Loading rates' : 'Fallback rates'}
            </span>
          </div>
        </div>

        {/* Total Cross-Ledger Transactions */}
        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-xl shadow-xl hover:border-blue-500/30 transition-all duration-300">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Total Transactions
            </span>
            <span className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
              📊
            </span>
          </div>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-2xl lg:text-3xl font-extrabold tracking-tight text-white">
              {effectiveTotalCount.toLocaleString()}
            </span>
            <span className="text-xs font-semibold text-slate-400">txs</span>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <span className="px-2 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/20 text-blue-300 font-medium">
              Classic: {classicBreakdown?.count ?? totalPaymentsCount}
            </span>
            <span className="px-2 py-0.5 rounded-md bg-purple-500/10 border border-purple-500/20 text-purple-300 font-medium">
              Soroban: {sorobanBreakdown?.count ?? 0}
            </span>
          </div>
        </div>

        {/* Average Payment Size */}
        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-xl shadow-xl hover:border-amber-500/30 transition-all duration-300">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Avg Payment Size
            </span>
            <span className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              📐
            </span>
          </div>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-2xl lg:text-3xl font-extrabold tracking-tight text-white">
              {effectiveAverageSize.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <span className="text-xs font-semibold text-slate-400">XLM/tx</span>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <span className="px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-300 font-medium">
              Classic: {(classicBreakdown?.averageSize ?? 0).toFixed(2)} XLM
            </span>
            <span className="px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 font-medium">
              Soroban: {(sorobanBreakdown?.averageSize ?? 0).toFixed(2)} XLM
            </span>
          </div>
        </div>

        {/* Monitored Wallets */}
        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-xl shadow-xl hover:border-emerald-500/30 transition-all duration-300">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Monitored Wallets
            </span>
            <span className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              🔒
            </span>
          </div>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-2xl lg:text-3xl font-extrabold tracking-tight text-white">
              {activeWalletsCount}
            </span>
            <span className="text-xs font-semibold text-emerald-400">active</span>
          </div>
          <span className="text-xs text-slate-400">
            Real-time Horizon & Soroban Streams
          </span>
        </div>
      </div>
    </div>
  );
};