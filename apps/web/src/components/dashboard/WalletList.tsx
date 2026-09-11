import React from 'react';
import { WalletDTO } from '@stellar-alerts/shared';

interface WalletListProps {
  wallets: WalletDTO[];
  selectedWalletId: string | null;
  onSelectWallet: (id: string | null) => void;
  onRemoveWallet: (id: string) => void;
  onOpenAddModal: () => void;
  isStreamConnected?: boolean;
}

export const WalletList: React.FC<WalletListProps> = ({
  wallets,
  selectedWalletId,
  onSelectWallet,
  onRemoveWallet,
  onOpenAddModal,
  isStreamConnected = true,
}) => {
  return (
    <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-xl shadow-xl mb-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span>👛</span> Registered Stellar Wallets
            </h2>
            {isStreamConnected ? (
              <span
                data-testid="stream-status-badge"
                className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold"
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                Stream Connected
              </span>
            ) : (
              <span
                data-testid="stream-status-badge"
                className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold"
              >
                <span className="h-2 w-2 rounded-full bg-amber-500"></span>
                Stream Disconnected
              </span>
            )}
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Real-time Horizon REST &amp; SSE payment stream watchers active.
          </p>
        </div>
        <button
          onClick={onOpenAddModal}
          className="px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium text-sm transition-all duration-200 shadow-lg shadow-purple-600/20 flex items-center justify-center gap-2"
        >
          <span>+</span> Add Stellar Wallet
        </button>
      </div>

      {wallets.length === 0 ? (
        <div className="p-8 text-center rounded-xl bg-slate-950/40 border border-slate-800/80">
          <p className="text-slate-400 text-sm">No Stellar public wallets registered yet.</p>
          <button
            onClick={onOpenAddModal}
            className="mt-3 text-sm font-semibold text-purple-400 hover:text-purple-300 transition-colors"
          >
            + Register your first Stellar public key
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <button
            onClick={() => onSelectWallet(null)}
            className={`p-4 rounded-xl text-left border transition-all duration-200 ${
              selectedWalletId === null
                ? 'bg-purple-950/30 border-purple-500/50 shadow-md shadow-purple-500/10'
                : 'bg-slate-950/30 border-slate-800/60 hover:border-slate-700'
            }`}
          >
            <div className="font-semibold text-sm text-white">All Wallets Unified</div>
            <div className="text-xs text-slate-400 mt-1">Combined transaction ledger</div>
          </button>

          {wallets.map((wallet) => {
            const isSelected = selectedWalletId === wallet.id;
            return (
              <div
                key={wallet.id}
                onClick={() => onSelectWallet(wallet.id)}
                className={`p-4 rounded-xl border cursor-pointer transition-all duration-200 flex items-center justify-between group ${
                  isSelected
                    ? 'bg-purple-950/30 border-purple-500/50 shadow-md shadow-purple-500/10'
                    : 'bg-slate-950/30 border-slate-800/60 hover:border-slate-700'
                }`}
              >
                <div className="truncate pr-2">
                  <div className="font-semibold text-sm text-white truncate">
                    {wallet.label || 'Unnamed Wallet'}
                  </div>
                  <div className="text-xs text-slate-400 font-mono mt-1 truncate">
                    {wallet.publicKey.substring(0, 8)}...{wallet.publicKey.substring(48)}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveWallet(wallet.id);
                  }}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors opacity-0 group-hover:opacity-100"
                  title="Remove wallet"
                >
                  🗑️
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
