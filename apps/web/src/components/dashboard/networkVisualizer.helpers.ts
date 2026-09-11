/**
 * Pure, dependency-free helpers for the 3D NetworkVisualizer.
 *
 * Everything WebGL/three.js-specific lives in `NetworkVisualizer3D.tsx`; this
 * module only turns a list of payments into plain numbers and coordinates so it
 * can be unit-tested in jsdom without a GL context.
 */

export interface VisualizerPayment {
  id: string;
  fromAddress: string | null | undefined;
  /** Destination account (usually the watched wallet's public key). */
  toAddress?: string | null;
  amount: number | string;
  asset: string;
  receivedAt?: string | Date;
}

export interface StreamNode {
  /** Stellar account address (or a synthetic id for the hub). */
  id: string;
  position: [number, number, number];
  /** True for the central watched-wallet node. */
  isHub: boolean;
}

export interface PaymentStream {
  id: string;
  from: string;
  to: string;
  amount: number;
  asset: string;
  /** Hex colour derived from the asset code. */
  color: string;
  /** Particle travel speed in world-units per second. */
  speed: number;
  /** Number of particles rendered flowing along this beam. */
  particleCount: number;
  /** Source node position. */
  fromPosition: [number, number, number];
  /** Destination node position. */
  toPosition: [number, number, number];
}

export interface VisualizerScene {
  nodes: StreamNode[];
  streams: PaymentStream[];
}

export const HUB_ID = '__hub__';

/** Ring radius the sender nodes are laid out on, in world units. */
const RING_RADIUS = 6;

/** Known Stellar asset codes get a stable, recognisable colour. */
const ASSET_COLORS: Record<string, string> = {
  XLM: '#22d3ee', // cyan-400
  USDC: '#3b82f6', // blue-500
  USDT: '#22c55e', // green-500
  AQUA: '#a855f7', // purple-500
  YXLM: '#f59e0b', // amber-500
  YUSDC: '#818cf8', // indigo-400
  BTC: '#f7931a',
  ETH: '#8b98b8',
};

const FALLBACK_PALETTE = [
  '#ec4899', // pink-500
  '#14b8a6', // teal-500
  '#f43f5e', // rose-500
  '#84cc16', // lime-500
  '#06b6d4', // cyan-500
  '#d946ef', // fuchsia-500
];

/**
 * Maps an asset code to a deterministic hex colour. Known assets use a fixed
 * palette; unknown ones are hashed into a stable fallback colour so the same
 * asset always renders the same hue across re-renders.
 */
export function assetColor(asset: string | null | undefined): string {
  const code = (asset ?? '').trim().toUpperCase();
  if (!code) return '#64748b'; // slate-500
  if (ASSET_COLORS[code]) return ASSET_COLORS[code];

  let hash = 0;
  for (let i = 0; i < code.length; i += 1) {
    hash = (hash * 31 + code.charCodeAt(i)) | 0;
  }
  return FALLBACK_PALETTE[Math.abs(hash) % FALLBACK_PALETTE.length];
}

/** Coerces a possibly-string, possibly-NaN amount to a finite, non-negative number. */
export function normalizeAmount(amount: number | string): number {
  const n = typeof amount === 'number' ? amount : parseFloat(amount);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Larger payments flow faster. Uses a log scale so a 10-XLM tip and a
 * 1,000,000-XLM settlement both stay on screen, clamped to a sane range.
 */
export function amountToSpeed(amount: number | string): number {
  const value = normalizeAmount(amount);
  const speed = 0.6 + Math.log10(1 + value) * 0.45;
  return Math.min(Math.max(speed, 0.6), 4);
}

/** Larger payments render as a denser particle beam. */
export function amountToParticleCount(amount: number | string): number {
  const value = normalizeAmount(amount);
  const count = Math.round(8 + Math.log10(1 + value) * 12);
  return Math.min(Math.max(count, 8), 64);
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

/** Deterministic ring layout: sender `index` of `total` senders around the hub. */
export function nodePosition(address: string, index: number, total: number): [number, number, number] {
  const angle = total > 0 ? (index / total) * Math.PI * 2 : 0;
  const wobble = ((hashString(address) % 1000) / 1000 - 0.5) * 3; // stable ±1.5 on Y
  return [
    Math.cos(angle) * RING_RADIUS,
    wobble,
    Math.sin(angle) * RING_RADIUS,
  ];
}

/**
 * Turns a payment list into a renderable scene graph: one central hub node for
 * the watched wallet and one node per distinct sender, with a stream (beam)
 * from each payment's sender to the hub.
 */
export function buildScene(
  payments: VisualizerPayment[],
  options: { limit?: number } = {},
): VisualizerScene {
  const limit = options.limit ?? 40;
  const recent = payments.slice(0, limit);

  const senders: string[] = [];
  for (const payment of recent) {
    const from = payment.fromAddress?.trim();
    if (from && !senders.includes(from)) senders.push(from);
  }

  const hub: StreamNode = { id: HUB_ID, position: [0, 0, 0], isHub: true };
  const senderNodes: StreamNode[] = senders.map((address, index) => ({
    id: address,
    position: nodePosition(address, index, senders.length),
    isHub: false,
  }));
  const positionByAddress = new Map(senderNodes.map((node) => [node.id, node.position]));

  const streams: PaymentStream[] = recent
    .filter((payment) => payment.fromAddress?.trim())
    .map((payment) => {
      const from = payment.fromAddress!.trim();
      return {
        id: payment.id,
        from,
        to: HUB_ID,
        amount: normalizeAmount(payment.amount),
        asset: (payment.asset ?? '').toUpperCase() || 'XLM',
        color: assetColor(payment.asset),
        speed: amountToSpeed(payment.amount),
        particleCount: amountToParticleCount(payment.amount),
        fromPosition: positionByAddress.get(from) ?? [0, 0, 0],
        toPosition: hub.position,
      };
    });

  return { nodes: [hub, ...senderNodes], streams };
}

/** Distinct asset codes present in the scene, for rendering a colour legend. */
export function sceneLegend(scene: VisualizerScene): { asset: string; color: string }[] {
  const seen = new Map<string, string>();
  for (const stream of scene.streams) {
    if (!seen.has(stream.asset)) seen.set(stream.asset, stream.color);
  }
  return [...seen.entries()].map(([asset, color]) => ({ asset, color }));
}
