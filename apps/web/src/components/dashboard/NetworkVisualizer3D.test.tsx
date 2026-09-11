import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PaymentDTO } from '@stellar-alerts/shared';

// three.js needs a real WebGL context, which jsdom does not provide. Mock the
// <Canvas> host so the DOM chrome (title, legend, stream count) can be asserted
// without touching GL. The scene-graph logic itself is covered via the pure
// helpers below.
vi.mock('@react-three/fiber', () => ({
  Canvas: () => <div data-testid="r3f-canvas" />,
  useFrame: () => undefined,
}));

import { NetworkVisualizer3D } from './NetworkVisualizer3D';
import {
  assetColor,
  amountToSpeed,
  amountToParticleCount,
  normalizeAmount,
  buildScene,
  sceneLegend,
  HUB_ID,
  type VisualizerPayment,
} from './networkVisualizer.helpers';

const makePayment = (over: Partial<PaymentDTO> = {}): PaymentDTO => ({
  id: Math.random().toString(36).slice(2),
  walletId: 'w1',
  txHash: 'hash',
  fromAddress: 'GA' + 'X'.repeat(54),
  amount: 100,
  asset: 'XLM',
  receivedAt: new Date().toISOString(),
  ...over,
});

describe('networkVisualizer.helpers', () => {
  describe('assetColor', () => {
    it('maps known assets to stable, distinct colours', () => {
      expect(assetColor('XLM')).toBe('#22d3ee');
      expect(assetColor('USDC')).toBe('#3b82f6');
      expect(assetColor('xlm')).toBe(assetColor('XLM'));
      expect(assetColor('XLM')).not.toBe(assetColor('USDC'));
    });

    it('hashes unknown assets deterministically into the fallback palette', () => {
      const a = assetColor('WEIRDTOKEN');
      const b = assetColor('WEIRDTOKEN');
      expect(a).toBe(b);
      expect(a).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('falls back to a neutral colour for empty/missing assets', () => {
      expect(assetColor('')).toBe('#64748b');
      expect(assetColor(null)).toBe('#64748b');
    });
  });

  describe('normalizeAmount', () => {
    it('coerces strings and rejects NaN / negatives', () => {
      expect(normalizeAmount('250.5')).toBe(250.5);
      expect(normalizeAmount('not-a-number')).toBe(0);
      expect(normalizeAmount(-10)).toBe(0);
    });
  });

  describe('amountToSpeed', () => {
    it('increases monotonically with payment amount', () => {
      expect(amountToSpeed(10)).toBeLessThan(amountToSpeed(1000));
      expect(amountToSpeed(1000)).toBeLessThan(amountToSpeed(100000));
    });

    it('clamps to a renderable range for extreme values', () => {
      expect(amountToSpeed(0)).toBeGreaterThanOrEqual(0.6);
      expect(amountToSpeed(1e12)).toBeLessThanOrEqual(4);
    });
  });

  describe('amountToParticleCount', () => {
    it('produces a denser beam for larger amounts, within bounds', () => {
      expect(amountToParticleCount(1)).toBeGreaterThanOrEqual(8);
      expect(amountToParticleCount(1)).toBeLessThan(amountToParticleCount(50000));
      expect(amountToParticleCount(1e9)).toBeLessThanOrEqual(64);
    });
  });

  describe('buildScene', () => {
    it('returns an empty scene for no payments', () => {
      const scene = buildScene([]);
      expect(scene.streams).toHaveLength(0);
      expect(scene.nodes).toEqual([{ id: HUB_ID, position: [0, 0, 0], isHub: true }]);
    });

    it('creates one hub node plus one node per distinct sender', () => {
      const payments: VisualizerPayment[] = [
        { id: '1', fromAddress: 'GAAA', amount: 10, asset: 'XLM' },
        { id: '2', fromAddress: 'GAAA', amount: 20, asset: 'XLM' },
        { id: '3', fromAddress: 'GBBB', amount: 30, asset: 'USDC' },
      ];
      const scene = buildScene(payments);
      const hubs = scene.nodes.filter((n) => n.isHub);
      expect(hubs).toHaveLength(1);
      expect(scene.nodes.filter((n) => !n.isHub).map((n) => n.id).sort()).toEqual(['GAAA', 'GBBB']);
      expect(scene.streams).toHaveLength(3);
      expect(scene.streams.every((s) => s.to === HUB_ID)).toBe(true);
    });

    it('reflects amount in speed/particleCount and asset in colour per stream', () => {
      const scene = buildScene([
        { id: 'small', fromAddress: 'GAAA', amount: 5, asset: 'XLM' },
        { id: 'big', fromAddress: 'GBBB', amount: 500000, asset: 'USDC' },
      ]);
      const small = scene.streams.find((s) => s.id === 'small')!;
      const big = scene.streams.find((s) => s.id === 'big')!;
      expect(big.speed).toBeGreaterThan(small.speed);
      expect(big.particleCount).toBeGreaterThan(small.particleCount);
      expect(small.color).toBe(assetColor('XLM'));
      expect(big.color).toBe(assetColor('USDC'));
    });

    it('ignores payments with no sender address and respects the limit', () => {
      const payments: VisualizerPayment[] = [
        { id: 'ok', fromAddress: 'GAAA', amount: 1, asset: 'XLM' },
        { id: 'nosender', fromAddress: '  ', amount: 1, asset: 'XLM' },
      ];
      expect(buildScene(payments).streams.map((s) => s.id)).toEqual(['ok']);

      const many: VisualizerPayment[] = Array.from({ length: 100 }, (_, i) => ({
        id: `p${i}`,
        fromAddress: `G${i}`,
        amount: 1,
        asset: 'XLM',
      }));
      expect(buildScene(many, { limit: 10 }).streams).toHaveLength(10);
    });

    it('lays sender nodes out deterministically (stable across calls)', () => {
      const payments: VisualizerPayment[] = [
        { id: '1', fromAddress: 'GAAA', amount: 1, asset: 'XLM' },
        { id: '2', fromAddress: 'GBBB', amount: 1, asset: 'XLM' },
      ];
      expect(buildScene(payments).nodes).toEqual(buildScene(payments).nodes);
    });
  });

  describe('sceneLegend', () => {
    it('lists each distinct asset once with its colour', () => {
      const scene = buildScene([
        { id: '1', fromAddress: 'GAAA', amount: 1, asset: 'XLM' },
        { id: '2', fromAddress: 'GBBB', amount: 1, asset: 'XLM' },
        { id: '3', fromAddress: 'GCCC', amount: 1, asset: 'USDC' },
      ]);
      expect(sceneLegend(scene)).toEqual([
        { asset: 'XLM', color: assetColor('XLM') },
        { asset: 'USDC', color: assetColor('USDC') },
      ]);
    });
  });

  // Acceptance criteria: "Component render performance test".
  describe('performance', () => {
    it('builds a scene from 5,000 payments in under 50ms', () => {
      const payments: VisualizerPayment[] = Array.from({ length: 5000 }, (_, i) => ({
        id: `p${i}`,
        fromAddress: `GACCOUNT${i % 250}`,
        amount: (i % 97) * 13.37,
        asset: i % 2 ? 'XLM' : 'USDC',
      }));
      const start = performance.now();
      const scene = buildScene(payments, { limit: 200 });
      const elapsed = performance.now() - start;
      expect(scene.streams.length).toBe(200);
      expect(elapsed).toBeLessThan(50);
    });
  });
});

describe('<NetworkVisualizer3D />', () => {
  it('shows the empty state and no canvas when there are no payments', () => {
    render(<NetworkVisualizer3D payments={[]} />);
    expect(screen.getByTestId('active-stream-count')).toHaveTextContent('0 active streams');
    expect(screen.queryByTestId('r3f-canvas')).not.toBeInTheDocument();
    expect(screen.getByText(/No payment streams to visualise yet/i)).toBeInTheDocument();
  });

  it('mounts the canvas and reports the active stream count for real payments', () => {
    const payments = [
      makePayment({ id: 'a', fromAddress: 'GAAA', amount: 12, asset: 'XLM' }),
      makePayment({ id: 'b', fromAddress: 'GBBB', amount: 999, asset: 'USDC' }),
    ];
    render(<NetworkVisualizer3D payments={payments} />);
    expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('active-stream-count')).toHaveTextContent('2 active streams');
  });

  it('renders a colour legend entry per distinct asset', () => {
    const payments = [
      makePayment({ id: 'a', fromAddress: 'GAAA', amount: 10, asset: 'XLM' }),
      makePayment({ id: 'b', fromAddress: 'GBBB', amount: 20, asset: 'USDC' }),
      makePayment({ id: 'c', fromAddress: 'GCCC', amount: 30, asset: 'XLM' }),
    ];
    render(<NetworkVisualizer3D payments={payments} />);
    const legend = screen.getByTestId('asset-legend');
    expect(legend).toHaveTextContent('XLM');
    expect(legend).toHaveTextContent('USDC');
    expect(screen.getByTestId('legend-swatch-XLM')).toHaveStyle({ backgroundColor: '#22d3ee' });
  });

  it('renders a large payment set quickly (component-level perf smoke test)', () => {
    const payments = Array.from({ length: 400 }, (_, i) =>
      makePayment({ id: `p${i}`, fromAddress: `G${i}`, amount: i, asset: i % 2 ? 'XLM' : 'USDC' }),
    );
    const start = performance.now();
    render(<NetworkVisualizer3D payments={payments} maxStreams={60} />);
    const elapsed = performance.now() - start;
    expect(screen.getByTestId('active-stream-count')).toHaveTextContent('60 active streams');
    expect(elapsed).toBeLessThan(400);
  });
});
