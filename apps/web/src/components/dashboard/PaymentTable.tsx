import React, { useState, useMemo } from 'react';
import { PaymentDTO, filterPayments, extractAvailableAssets } from '@stellar-alerts/shared';

interface PaymentTableProps {
  payments: PaymentDTO[];
  isLoading: boolean;
}

export const PaymentTable: React.FC<PaymentTableProps> = ({ payments = [], isLoading }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAsset, setSelectedAsset] = useState('ALL');

  // Extract unique available assets from payments list
  const availableAssets = useMemo(() => {
    return extractAvailableAssets(payments);
  }, [payments]);

  // Client-side filtering logic
  const filteredPayments = useMemo(() => {
    return filterPayments(payments, searchQuery, selectedAsset);
  }, [payments, searchQuery, selectedAsset]);

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedAsset('ALL');
  };

  const isFiltered = searchQuery.trim() !== '' || selectedAsset !== 'ALL';

  const exportToCSV = () => {
    const listToExport = filteredPayments.length > 0 || isFiltered ? filteredPayments : payments;
    if (!listToExport || listToExport.length === 0) return;

    const headers = ['ID', 'Wallet ID', 'Tx Hash', 'From Address', 'Amount', 'Asset', 'Memo', 'Received At'];
    const rows = listToExport.map((p) => [
      p.id,
      p.walletId,
      p.txHash,
      p.fromAddress || '',
      p.amount,
      p.asset,
      p.memo || '',
      new Date(p.receivedAt).toISOString(),
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) =>
        row
          .map((field) => {
            const stringified = String(field ?? '');
            if (stringified.includes(',') || stringified.includes('"') || stringified.includes('\n')) {
              return `"${stringified.replace(/"/g, '""')}"`;
            }
            return stringified;
          })
          .join(',')
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'stellar-payments.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportToJSON = () => {
    const listToExport = filteredPayments.length > 0 || isFiltered ? filteredPayments : payments;
    if (!listToExport || listToExport.length === 0) return;

    const jsonContent = JSON.stringify(listToExport, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'stellar-payments.json');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-xl shadow-xl space-y-6">
      {/* Header & Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span>⚡</span> Real-Time Payment Ledger
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Incoming blockchain operations ingested via Horizon stream &amp; deduplicated by transaction hash.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {payments.length > 0 && (
            <div className="text-xs text-slate-400 font-mono bg-slate-800/50 px-3 py-1.5 rounded-lg border border-slate-700/50">
              Showing <span className="text-cyan-400 font-semibold">{filteredPayments.length}</span> of{' '}
              <span className="text-slate-300">{payments.length}</span> operations
            </div>
          )}
          <button
            onClick={exportToCSV}
            disabled={payments.length === 0}
            className="px-3.5 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-md cursor-pointer"
            title="Download payments as CSV file"
          >
            <span>📥</span> Export CSV
          </button>
          <button
            onClick={exportToJSON}
            disabled={payments.length === 0}
            className="px-3.5 py-1.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-md cursor-pointer"
            title="Download payments as JSON file"
          >
            <span>📄</span> Export JSON
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      {payments.length > 0 && (
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              data-testid="search-input"
              id="payment-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by sender address (G...), tx hash, or asset..."
              className="w-full pl-10 pr-9 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/80 focus:ring-1 focus:ring-cyan-500/50 transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-200 transition-colors"
                title="Clear search text"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="relative min-w-[130px]">
              <select
                data-testid="asset-filter-select"
                id="asset-filter-select"
                value={selectedAsset}
                onChange={(e) => setSelectedAsset(e.target.value)}
                className="w-full pl-3 pr-8 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-slate-200 focus:outline-none focus:border-cyan-500/80 focus:ring-1 focus:ring-cyan-500/50 appearance-none cursor-pointer"
              >
                {availableAssets.map((asset) => (
                  <option key={asset} value={asset}>
                    {asset === 'ALL' ? 'All Assets' : asset}
                  </option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center pointer-events-none text-slate-400">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>

            {isFiltered && (
              <button
                type="button"
                data-testid="reset-filters-btn"
                onClick={handleResetFilters}
                className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-300 hover:text-white transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Table / Status Section */}
      {isLoading ? (
        <div className="p-12 text-center text-slate-400 text-sm">
          <div className="animate-pulse">Loading transaction records...</div>
        </div>
      ) : payments.length === 0 ? (
        <div className="p-12 text-center text-slate-400 text-sm rounded-xl bg-slate-950/40 border border-slate-800/80">
          No payments recorded yet. Trigger a payment on Stellar Testnet to see live ingestion!
        </div>
      ) : filteredPayments.length === 0 ? (
        <div className="p-10 text-center rounded-xl bg-slate-950/40 border border-slate-800/80 space-y-3">
          <p className="text-slate-300 text-sm font-medium">No payments match your search filter criteria.</p>
          <p className="text-slate-500 text-xs">Try clearing your search query or selecting a different asset filter.</p>
          <button
            type="button"
            onClick={handleResetFilters}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 text-xs font-semibold transition-colors mt-2 cursor-pointer"
          >
            <span>Reset Search Filters</span>
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <th className="py-3.5 px-4">Timestamp</th>
                <th className="py-3.5 px-4">Amount</th>
                <th className="py-3.5 px-4">Asset</th>
                <th className="py-3.5 px-4">Sender Address</th>
                <th className="py-3.5 px-4">Tx Hash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {filteredPayments.map((payment) => (
                <tr key={payment.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="py-3.5 px-4 text-xs font-mono text-slate-400 whitespace-nowrap">
                    {new Date(payment.receivedAt).toLocaleString()}
                  </td>
                  <td className="py-3.5 px-4 font-semibold text-emerald-400 whitespace-nowrap">
                    +{Number(payment.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-3.5 px-4 whitespace-nowrap">
                    <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
                      {payment.asset}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 font-mono text-xs text-slate-400 whitespace-nowrap">
                    {payment.fromAddress ? (
                      <span title={payment.fromAddress}>
                        {payment.fromAddress.length > 16
                          ? `${payment.fromAddress.substring(0, 8)}...${payment.fromAddress.substring(payment.fromAddress.length - 8)}`
                          : payment.fromAddress}
                      </span>
                    ) : (
                      'System / Genesis'
                    )}
                  </td>
                  <td className="py-3.5 px-4 font-mono text-xs text-slate-400 whitespace-nowrap">
                    <a
                      href={`https://stellar.expert/explorer/testnet/tx/${payment.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors flex items-center gap-1"
                    >
                      <span>{payment.txHash ? `${payment.txHash.substring(0, 8)}...` : 'View Tx'}</span>
                      <span className="text-[10px]">↗</span>
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
