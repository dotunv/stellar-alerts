// Generated from the API's OpenAPI schema — see scripts/generate-types.ts.
// Re-exported under a `Api` namespace to avoid clashing with the
// hand-written DTOs below (`components["schemas"]["RequestLinkInput"]`, etc).
export type { components as ApiComponents, paths as ApiPaths } from './generated/api-types';

export interface UserDTO {
  id: string;
  email: string;
  createdAt: Date | string;
}

export interface WalletDTO {
  id: string;
  userId: string;
  publicKey: string;
  label?: string | null;
  createdAt: Date | string;
}

export interface PaymentDTO {
  id: string;
  walletId: string;
  txHash: string;
  fromAddress: string;
  amount: number | string;
  asset: string;
  memo?: string | null;
  receivedAt: Date | string;
}

export interface NotificationPreferenceDTO {
  id: string;
  userId: string;
  telegramChatId?: string | null;
  telegramEnabled: boolean;
  emailEnabled: boolean;
  whatsappNumber?: string | null;
  whatsappEnabled: boolean;
}

/**
 * Validates whether a given string is a valid Stellar Ed25519 Public Key (starts with G, 56 chars).
 */
export function isValidStellarPublicKey(publicKey: string): boolean {
  return (
    typeof publicKey === 'string' &&
    publicKey.length === 56 &&
    publicKey.startsWith('G')
  );
}

/**
 * Filters a list of payments by search query (address, txHash, asset, memo) and asset code.
 */
export function filterPayments<T extends PaymentDTO>(
  payments: T[],
  searchQuery: string,
  selectedAsset: string = 'ALL'
): T[] {
  const query = searchQuery.trim().toLowerCase();
  return payments.filter((payment) => {
    const matchesQuery =
      !query ||
      (payment.fromAddress && payment.fromAddress.toLowerCase().includes(query)) ||
      (payment.txHash && payment.txHash.toLowerCase().includes(query)) ||
      (payment.asset && payment.asset.toLowerCase().includes(query)) ||
      (payment.memo && payment.memo.toLowerCase().includes(query));

    const matchesAsset =
      selectedAsset === 'ALL' ||
      (payment.asset && payment.asset.toUpperCase() === selectedAsset.toUpperCase());

    return matchesQuery && matchesAsset;
  });
}

/**
 * Extracts unique asset codes from a payments list with 'ALL' as the first default option.
 */
export function extractAvailableAssets(payments: PaymentDTO[]): string[] {
  const assets = new Set<string>();
  payments.forEach((p) => {
    if (p.asset) {
      assets.add(p.asset.toUpperCase());
    }
  });
  return ['ALL', ...Array.from(assets).sort()];
}

