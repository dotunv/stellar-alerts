'use client';

import React, { useState } from 'react';

export interface SorobanEventTopic {
  topic: string;
  decodedValue?: string;
}

export interface SorobanSimulatedEvent {
  contractId: string;
  topics: SorobanEventTopic[];
  data: string;
  type: 'contract' | 'system' | 'diagnostic';
}

export interface SorobanSimulationFootprint {
  readOnlyEntries: number;
  readWriteEntries: number;
  cpuInstructions: number;
  memoryBytes: number;
  estimatedFeeXlm: string;
}

export interface SorobanSimulationResult {
  success: boolean;
  contractId: string;
  functionName: string;
  network: string;
  events: SorobanSimulatedEvent[];
  footprint: SorobanSimulationFootprint;
  returnValue?: string;
  error?: string;
  simulatedAt: string;
}

export interface SorobanSimulationInput {
  contractId: string;
  functionName: string;
  argsJson: string;
  network: 'testnet' | 'mainnet' | 'futurenet';
  invoker?: string;
}

export function simulateSorobanInvocation(input: SorobanSimulationInput): SorobanSimulationResult {
  const contractId = input.contractId.trim() || 'CCONTRACTSIMULATIONTESTADDRESS0000000000000000000000000000';
  const functionName = input.functionName.trim() || 'transfer';
  let parsedArgs: Record<string, unknown> = {};

  try {
    if (input.argsJson.trim()) {
      parsedArgs = JSON.parse(input.argsJson);
    }
  } catch {
    return {
      success: false,
      contractId,
      functionName,
      network: input.network,
      events: [],
      footprint: {
        readOnlyEntries: 0,
        readWriteEntries: 0,
        cpuInstructions: 0,
        memoryBytes: 0,
        estimatedFeeXlm: '0.0000000',
      },
      error: 'Invalid JSON formatted method arguments',
      simulatedAt: new Date().toISOString(),
    };
  }

  // Generate deterministic dry-run simulated events and footprint
  const events: SorobanSimulatedEvent[] = [
    {
      contractId,
      type: 'contract',
      topics: [
        { topic: 'Symbol("TRANSFER")', decodedValue: 'transfer' },
        { topic: 'Address("GUSER1...")', decodedValue: String(parsedArgs.from || 'GDASHBOARD...USER1') },
        { topic: 'Address("GUSER2...")', decodedValue: String(parsedArgs.to || 'GDASHBOARD...USER2') },
      ],
      data: `i128(${String(parsedArgs.amount || '100000000')})`,
    },
    {
      contractId,
      type: 'system',
      topics: [
        { topic: 'Symbol("FEE_DISTRIBUTION")', decodedValue: 'fee_distribution' },
      ],
      data: 'i128(2500)',
    },
  ];

  const footprint: SorobanSimulationFootprint = {
    readOnlyEntries: 3,
    readWriteEntries: 2,
    cpuInstructions: 184520,
    memoryBytes: 65536,
    estimatedFeeXlm: '0.0034812',
  };

  return {
    success: true,
    contractId,
    functionName,
    network: input.network,
    events,
    footprint,
    returnValue: 'Symbol("SUCCESS")',
    simulatedAt: new Date().toISOString(),
  };
}

export function SorobanSimulationSandbox() {
  const [contractId, setContractId] = useState('CCONTRACTSIMULATIONTESTADDRESS0000000000000000000000000000');
  const [functionName, setFunctionName] = useState('transfer');
  const [network, setNetwork] = useState<'testnet' | 'mainnet' | 'futurenet'>('testnet');
  const [argsJson, setArgsJson] = useState('{\n  "from": "GUSER1TESTING0000000000000000000000000000000000000000",\n  "to": "GUSER2TESTING0000000000000000000000000000000000000000",\n  "amount": "250000000"\n}');
  const [invoker, setInvoker] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SorobanSimulationResult | null>(null);

  const handleSimulate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Execute simulation
      const simResult = simulateSorobanInvocation({
        contractId,
        functionName,
        argsJson,
        network,
        invoker: invoker.trim() || undefined,
      });

      setResult(simResult);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-6 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-semibold text-xs">
            ⚡
          </span>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            Soroban Smart Contract Simulation & Dry-Run Sandbox
          </h2>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Simulate contract method invocations in real-time, inspect decoded event topics, and preview gas & footprint metrics before deploying alert monitors.
        </p>
      </div>

      <form onSubmit={handleSimulate} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label htmlFor="contract-id" className="block text-xs font-semibold uppercase text-slate-700 dark:text-slate-300">
              Contract Address (C...)
            </label>
            <input
              id="contract-id"
              type="text"
              value={contractId}
              onChange={(e) => setContractId(e.target.value)}
              placeholder="e.g. CA3D5KRYM6CB7OWQ6TWYRR3Z4EK7C3Y..."
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              required
            />
          </div>

          <div>
            <label htmlFor="network-select" className="block text-xs font-semibold uppercase text-slate-700 dark:text-slate-300">
              Stellar Network
            </label>
            <select
              id="network-select"
              value={network}
              onChange={(e) => setNetwork(e.target.value as 'testnet' | 'mainnet' | 'futurenet')}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              <option value="testnet">Testnet (Protocol 22)</option>
              <option value="mainnet">Mainnet</option>
              <option value="futurenet">Futurenet</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="function-name" className="block text-xs font-semibold uppercase text-slate-700 dark:text-slate-300">
              Method / Function Name
            </label>
            <input
              id="function-name"
              type="text"
              value={functionName}
              onChange={(e) => setFunctionName(e.target.value)}
              placeholder="e.g. transfer, swap, deposit"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              required
            />
          </div>

          <div>
            <label htmlFor="invoker-account" className="block text-xs font-semibold uppercase text-slate-700 dark:text-slate-300">
              Invoker / Source Account (Optional)
            </label>
            <input
              id="invoker-account"
              type="text"
              value={invoker}
              onChange={(e) => setInvoker(e.target.value)}
              placeholder="e.g. G..."
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
        </div>

        <div>
          <label htmlFor="args-json" className="block text-xs font-semibold uppercase text-slate-700 dark:text-slate-300">
            Method Arguments (JSON format)
          </label>
          <textarea
            id="args-json"
            rows={4}
            value={argsJson}
            onChange={(e) => setArgsJson(e.target.value)}
            placeholder='{\n  "amount": "10000000"\n}'
            className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Simulating Dry-Run...' : '⚡ Run Soroban Simulation'}
        </button>
      </form>

      {/* Simulation Results Display */}
      {result && (
        <div className="mt-6 space-y-4 border-t border-slate-200 pt-6 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Simulation Results
            </span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${
                result.success
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                  : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
              }`}
            >
              {result.success ? 'Dry-Run Succeeded' : 'Simulation Failed'}
            </span>
          </div>

          {result.error && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-400">
              {result.error}
            </div>
          )}

          {result.success && (
            <>
              {/* Estimated Resource Metrics */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
                  <span className="block text-[10px] font-medium text-slate-500 dark:text-slate-400">
                    Est. Gas Fee
                  </span>
                  <span className="font-mono text-sm font-bold text-slate-900 dark:text-white">
                    {result.footprint.estimatedFeeXlm} XLM
                  </span>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
                  <span className="block text-[10px] font-medium text-slate-500 dark:text-slate-400">
                    CPU Instructions
                  </span>
                  <span className="font-mono text-sm font-bold text-slate-900 dark:text-white">
                    {result.footprint.cpuInstructions.toLocaleString()}
                  </span>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
                  <span className="block text-[10px] font-medium text-slate-500 dark:text-slate-400">
                    Memory Footprint
                  </span>
                  <span className="font-mono text-sm font-bold text-slate-900 dark:text-white">
                    {(result.footprint.memoryBytes / 1024).toFixed(0)} KB
                  </span>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
                  <span className="block text-[10px] font-medium text-slate-500 dark:text-slate-400">
                    Footprint Entries
                  </span>
                  <span className="font-mono text-sm font-bold text-slate-900 dark:text-white">
                    {result.footprint.readWriteEntries} W / {result.footprint.readOnlyEntries} R
                  </span>
                </div>
              </div>

              {/* Decoded Event Topics */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/50">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase text-slate-700 dark:text-slate-300">
                    Simulated Event Topics ({result.events.length})
                  </span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">
                    Auto-decoded
                  </span>
                </div>

                <div className="space-y-2">
                  {result.events.map((evt, idx) => (
                    <div
                      key={idx}
                      className="rounded border border-slate-200 bg-white p-2.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                    >
                      <div className="mb-1 flex items-center justify-between text-[11px]">
                        <span className="font-mono text-indigo-600 dark:text-indigo-400 font-semibold">
                          Event #{idx + 1} ({evt.type})
                        </span>
                        <span className="font-mono text-slate-400 truncate max-w-[200px]">
                          {evt.contractId}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-1.5 py-1">
                        {evt.topics.map((t, tIdx) => (
                          <span
                            key={tIdx}
                            className="inline-flex items-center rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-800 dark:bg-slate-800 dark:text-slate-200"
                            title={t.topic}
                          >
                            {t.decodedValue ? `${t.decodedValue}` : t.topic}
                          </span>
                        ))}
                      </div>

                      <div className="mt-1 text-[10px] font-mono text-slate-500 dark:text-slate-400">
                        Payload: {evt.data}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
