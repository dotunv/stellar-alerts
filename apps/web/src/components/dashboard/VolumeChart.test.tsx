import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  VolumeChart,
  buildThirtyDayVolumeSeries,
  spreadTotalVolumeAcrossSeries,
} from './VolumeChart';
import { FALLBACK_XLM_RATES } from './currency';

describe('VolumeChart', () => {
  it('builds a 30-day XLM-only volume series from payment records', () => {
    const series = buildThirtyDayVolumeSeries(
      [
        { amount: '10.5', asset: 'XLM', receivedAt: '2026-08-28T10:00:00.000Z' },
        { amount: '4.5', asset: 'XLM', receivedAt: '2026-08-28T12:00:00.000Z' },
        { amount: '99', asset: 'USDC', receivedAt: '2026-08-28T12:00:00.000Z' },
      ],
      new Date('2026-08-29T00:00:00.000Z')
    );

    expect(series).toHaveLength(30);
    expect(series.find((point) => point.date === '2026-08-28')?.volumeXLM).toBe(15);
  });

  it('renders an interactive currency chart', () => {
    render(
      <VolumeChart
        payments={[{ amount: '100', asset: 'XLM', receivedAt: '2026-08-29T00:00:00.000Z' }]}
        rates={{ ...FALLBACK_XLM_RATES, USD: 0.2 }}
        referenceDate={new Date('2026-08-29T00:00:00.000Z')}
      />
    );

    fireEvent.click(screen.getByTestId('volume-currency-toggle-USD'));

    expect(screen.getByTestId('volume-chart-svg')).toBeInTheDocument();
    expect(screen.getByText('$20.00')).toBeInTheDocument();
  });

  it('spreads total volume into a chartable fallback series', () => {
    const series = spreadTotalVolumeAcrossSeries(300, new Date('2026-08-29T00:00:00.000Z'));

    expect(series).toHaveLength(30);
    expect(series.some((point) => point.volumeXLM > 0)).toBe(true);
  });
});