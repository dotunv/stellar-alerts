'use client';

import React, { useState, useMemo } from 'react';
const Code2Icon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M16 18l6-6-6-6M8 6l-6 6 6 6" /></svg>
);
const TagIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5a2 2 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" /></svg>
);
const CopyIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
);
const CheckIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
);
const DatabaseIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>
);
const ChevronRightIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
);
const ChevronDownIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
);

export interface SorobanDecodedTopic {
  symbol: string;
  type: string;
  value: unknown;
  xdrBase64?: string;
}

export interface SorobanContractEventItem {
  id: string;
  contractId: string;
  ledgerSeq: number;
  createdAt: string;
  eventType: 'contract' | 'system' | 'diagnostic';
  topics: SorobanDecodedTopic[];
  dataXdr: string;
  decodedData: Record<string, unknown>;
}

export const SAMPLE_SOROBAN_EVENTS: SorobanContractEventItem[] = [
  {
    id: 'evt_sac_transfer_001',
    contractId: 'CCONTRACTSAC2222222222222222222222222222222222222222222',
    ledgerSeq: 4892102,
    createdAt: '2026-08-30T14:22:10Z',
    eventType: 'contract',
    topics: [
      { symbol: 'transfer', type: 'Symbol', value: 'transfer', xdrBase64: 'AAAAEAAAAAh0cmFuc2Zlcg==' },
      { symbol: 'from', type: 'Address', value: 'GABC1234567890ACCOUNTDEEJAH000000000000000000000000000', xdrBase64: 'AAAAEAAAAA...' },
      { symbol: 'to', type: 'Address', value: 'GBUYER987654321ACCOUNTTESTER00000000000000000000000000', xdrBase64: 'AAAAEAAAAA...' },
    ],
    dataXdr: 'AAAAEgAAAAAAAABAAAAAAACW+g==',
    decodedData: {
      amount: '500.0000000',
      rawAmount: '5000000000',
      assetCode: 'USDC',
      assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335WFOPVQOI3M7G73X2D4J80000',
    },
  },
  {
    id: 'evt_mint_002',
    contractId: 'CCONTRACTPOOL111111111111111111111111111111111111111111',
    ledgerSeq: 4892105,
    createdAt: '2026-08-30T14:23:45Z',
    eventType: 'contract',
    topics: [
      { symbol: 'mint', type: 'Symbol', value: 'mint', xdrBase64: 'AAAAEAAAAARtaW50' },
      { symbol: 'to', type: 'Address', value: 'GMINTER0000000000000000000000000000000000000000000000', xdrBase64: 'AAAAEAAAAA...' },
    ],
    dataXdr: 'AAAAEgAAAAAAAABAAAAAAAFoEA==',
    decodedData: {
      amount: '1000.0000000',
      sharesIssued: '998.5000',
    },
  },
  {
    id: 'evt_swap_003',
    contractId: 'CCONTRACTAMMDEX33333333333333333333333333333333333333',
    ledgerSeq: 4892110,
    createdAt: '2026-08-30T14:25:00Z',
    eventType: 'contract',
    topics: [
      { symbol: 'swap', type: 'Symbol', value: 'swap', xdrBase64: 'AAAAEAAAAARzd2Fw' },
      { symbol: 'trader', type: 'Address', value: 'GTRADER55555555555555555555555555555555555555555555555', xdrBase64: 'AAAAEAAAAA...' },
      { symbol: 'pair', type: 'Vec', value: ['XLM', 'USDC'], xdrBase64: 'AAAAEAAAAA...' },
    ],
    dataXdr: 'AAAAEgAAAAAAAABAAAAAAAIZ0==',
    decodedData: {
      amountIn: '100.0000000',
      amountOut: '22.5000000',
      slippageBps: 15,
    },
  },
];

export interface SorobanEventInspectorProps {
  events?: SorobanContractEventItem[];
  initialContractFilter?: string;
  initialTopicFilter?: string;
}

export function SorobanEventInspector({
  events = SAMPLE_SOROBAN_EVENTS,
  initialContractFilter = '',
  initialTopicFilter = '',
}: SorobanEventInspectorProps) {
  const [contractFilter, setContractFilter] = useState(initialContractFilter);
  const [topicFilter, setTopicFilter] = useState(initialTopicFilter);
  const [selectedEventId, setSelectedEventId] = useState<string>(events[0]?.id || '');
  const [copied, setCopied] = useState(false);
  const [rawXdrExpanded, setRawXdrExpanded] = useState(true);

  const filteredEvents = useMemo(() => {
    return events.filter((evt) => {
      const matchesContract =
        !contractFilter.trim() ||
        evt.contractId.toLowerCase().includes(contractFilter.trim().toLowerCase());

      const matchesTopic =
        !topicFilter.trim() ||
        evt.topics.some((t) =>
          t.symbol.toLowerCase().includes(topicFilter.trim().toLowerCase()) ||
          String(t.value).toLowerCase().includes(topicFilter.trim().toLowerCase())
        );

      return matchesContract && matchesTopic;
    });
  }, [events, contractFilter, topicFilter]);

  const selectedEvent = useMemo(() => {
    return filteredEvents.find((e) => e.id === selectedEventId) || filteredEvents[0] || null;
  }, [filteredEvents, selectedEventId]);

  const copyEventJson = () => {
    if (!selectedEvent) return;
    navigator.clipboard.writeText(JSON.stringify(selectedEvent, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full bg-slate-900 border border-slate-800 rounded-xl overflow-hidden text-slate-100 shadow-xl" data-testid="soroban-event-inspector">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/60 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
            <Code2Icon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Soroban Contract Event Explorer</h2>
            <p className="text-xs text-slate-400">
              Inspect decoded XDR topics, contract events, and binary payloads in real-time
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2 text-xs text-slate-400">
          <span className="px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 font-mono">
            {filteredEvents.length} Event{filteredEvents.length === 1 ? '' : 's'} Found
          </span>
        </div>
      </div>

      {/* Controls & Filter Bar */}
      <div className="p-4 border-b border-slate-800 bg-slate-900/50 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="relative">
          <DatabaseIcon className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            data-testid="contract-id-input"
            value={contractFilter}
            onChange={(e) => setContractFilter(e.target.value)}
            placeholder="Filter by Contract ID (C...)..."
            className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
        <div className="relative">
          <TagIcon className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            data-testid="topic-symbol-input"
            value={topicFilter}
            onChange={(e) => setTopicFilter(e.target.value)}
            placeholder="Filter by Topic Symbol (e.g. transfer, mint, swap)..."
            className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
      </div>

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[420px]">
        {/* Left Event Stream List */}
        <div className="lg:col-span-5 border-r border-slate-800 bg-slate-950/40 max-h-[500px] overflow-y-auto divide-y divide-slate-800/60">
          {filteredEvents.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              No matching Soroban events found for current filter criteria.
            </div>
          ) : (
            filteredEvents.map((evt) => {
              const isSelected = selectedEvent?.id === evt.id;
              const primaryTopic = evt.topics[0]?.symbol || 'event';
              return (
                <button
                  key={evt.id}
                  onClick={() => setSelectedEventId(evt.id)}
                  className={`w-full text-left p-4 transition-colors flex flex-col gap-2 ${
                    isSelected
                      ? 'bg-indigo-600/10 border-l-4 border-indigo-500'
                      : 'hover:bg-slate-800/40'
                  }`}
                  data-testid={`event-item-${evt.id}`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="px-2 py-0.5 rounded text-xs font-mono font-medium bg-indigo-500/20 text-indigo-300">
                      {primaryTopic}
                    </span>
                    <span className="text-xs text-slate-500 font-mono">Ledger #{evt.ledgerSeq}</span>
                  </div>
                  <div className="text-xs font-mono text-slate-300 truncate w-full">
                    {evt.contractId}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {evt.topics.map((t, idx) => (
                      <span
                        key={idx}
                        className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400 border border-slate-700/50"
                      >
                        {t.symbol}: {String(t.value).substring(0, 12)}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Right Event Inspector Details */}
        <div className="lg:col-span-7 p-6 bg-slate-900 flex flex-col gap-6 max-h-[500px] overflow-y-auto">
          {selectedEvent ? (
            <>
              {/* Event Header Info */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-400 font-mono">Contract Event ID</div>
                  <div className="text-sm font-bold text-white font-mono">{selectedEvent.id}</div>
                </div>
                <button
                  onClick={copyEventJson}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
                >
                  {copied ? <CheckIcon className="w-3.5 h-3.5 text-emerald-400" /> : <CopyIcon className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied JSON' : 'Copy JSON'}</span>
                </button>
              </div>

              {/* Decoded Topic Tree Viewer */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
                  Decoded XDR Topic Structure
                </h3>
                <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs space-y-2">
                  {selectedEvent.topics.map((topic, idx) => (
                    <div key={idx} className="p-2.5 rounded bg-slate-900/80 border border-slate-800 flex flex-col gap-1">
                      <div className="flex items-center justify-between text-slate-300">
                        <span className="text-indigo-300 font-bold">Topic[{idx}]: {topic.symbol}</span>
                        <span className="text-[10px] text-slate-500 font-sans px-1.5 py-0.5 rounded bg-slate-800">
                          {topic.type}
                        </span>
                      </div>
                      <div className="text-slate-200 font-semibold break-all">
                        {JSON.stringify(topic.value, null, 2)}
                      </div>
                      {topic.xdrBase64 && (
                        <div className="text-[10px] text-slate-500 break-all">
                          XDR: <span className="text-slate-400">{topic.xdrBase64}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Decoded Event Data Payload JSON */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                  Decoded Event Data Payload
                </h3>
                <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs text-emerald-300 overflow-x-auto">
                  <pre data-testid="json-payload-tree">{JSON.stringify(selectedEvent.decodedData, null, 2)}</pre>
                </div>
              </div>

              {/* Raw Data XDR */}
              <div className="space-y-2">
                <button
                  onClick={() => setRawXdrExpanded(!rawXdrExpanded)}
                  className="flex items-center space-x-1 text-xs font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-200 transition-colors"
                >
                  {rawXdrExpanded ? <ChevronDownIcon className="w-3.5 h-3.5" /> : <ChevronRightIcon className="w-3.5 h-3.5" />}
                  <span>Raw Data XDR</span>
                </button>
                {rawXdrExpanded && (
                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs text-slate-400 break-all">
                    {selectedEvent.dataXdr}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="p-8 text-center text-slate-500 text-sm">
              Select an event from the left list to view its decoded XDR topics.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
