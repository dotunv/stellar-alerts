import { describe, it, expect } from 'vitest';
import { filterPayments, extractAvailableAssets, PaymentDTO } from '@stellar-alerts/shared';

describe('Payment Search & Asset Filter Unit Tests', () => {
  const samplePayments: PaymentDTO[] = [
    {
      id: 'pay-1',
      walletId: 'w-1',
      txHash: '7685776ceebcb978f1c425797e12ed9d59a69643a4114e48d84f0965f1878ab9',
      fromAddress: 'GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR',
      amount: '100.0000000',
      asset: 'XLM',
      receivedAt: '2026-08-24T12:00:00Z',
    },
    {
      id: 'pay-2',
      walletId: 'w-1',
      txHash: 'a8f3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3',
      fromAddress: 'GCKF65D4G57T7754Y62F76J5W7P3R2A1B0C9D8E7F6G5H4I3J2K1L0M',
      amount: '50.0000000',
      asset: 'USDC',
      receivedAt: '2026-08-24T12:05:00Z',
    },
    {
      id: 'pay-3',
      walletId: 'w-1',
      txHash: '999992c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3',
      fromAddress: 'GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR',
      amount: '20.0000000',
      asset: 'USDC',
      receivedAt: '2026-08-24T12:10:00Z',
    },
  ];

  it('should return all payments when search query is empty and asset filter is ALL', () => {
    const result = filterPayments(samplePayments, '', 'ALL');
    expect(result).toHaveLength(3);
  });

  it('should filter payments by sender address (fromAddress)', () => {
    const result = filterPayments(samplePayments, 'GCKF65D4', 'ALL');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('pay-2');
  });

  it('should filter payments case-insensitively by address', () => {
    const result = filterPayments(samplePayments, 'gaih3ullfq', 'ALL');
    expect(result).toHaveLength(2);
  });

  it('should filter payments by transaction hash (txHash)', () => {
    const result = filterPayments(samplePayments, '7685776c', 'ALL');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('pay-1');
  });

  it('should filter payments by asset code selection', () => {
    const resultXlm = filterPayments(samplePayments, '', 'XLM');
    expect(resultXlm).toHaveLength(1);
    expect(resultXlm[0].asset).toBe('XLM');

    const resultUsdc = filterPayments(samplePayments, '', 'USDC');
    expect(resultUsdc).toHaveLength(2);
  });

  it('should combine search query and asset filter correctly', () => {
    const result = filterPayments(samplePayments, 'GAIH3ULLFQ', 'USDC');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('pay-3');
  });

  it('should return empty array when no payment matches query', () => {
    const result = filterPayments(samplePayments, 'NON_EXISTENT_ADDRESS', 'ALL');
    expect(result).toHaveLength(0);
  });

  it('should extract unique asset codes with ALL as first option', () => {
    const assets = extractAvailableAssets(samplePayments);
    expect(assets).toEqual(['ALL', 'USDC', 'XLM']);
  });
});
