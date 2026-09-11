Stellar Alerts Web Application

A Next.js frontend for monitoring Stellar Testnet payments with real-time alerts and transaction history.

## Features

### Stellar Expert Block Explorer Link Generator

Transaction hashes in the Payment Ledger are automatically linked to Stellar Expert Testnet Explorer, allowing users to inspect raw ledger operations on-chain.

**How it works:**
- Each transaction hash (txHash) displayed in the payment table is wrapped in a clickable link
- Links open in a new tab to: `https://stellar.expert/explorer/testnet/tx/{txHash}`
- Visual indicator (↗) shows the link will open externally
- Hover effect highlights the link for better UX

**Implementation:** `src/components/dashboard/PaymentTable.tsx` (lines 255-265)

```tsx
<a
  href={`https://stellar.expert/explorer/testnet/tx/${payment.txHash}`}
  target="_blank"
  rel="noopener noreferrer"
  className="text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors flex items-center gap-1"
>
  <span>{payment.txHash ? `${payment.txHash.substring(0, 8)}...` : 'View Tx'}</span>
  <span className="text-[10px]">↗</span>
</a>
```

## Getting Started

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Project Structure

```
apps/web/
├── src/
│   ├── app/              # Next.js App Router pages
│   ├── components/
│   │   └── dashboard/
│   │       └── PaymentTable.tsx  # Payment ledger with Stellar Expert links
│   └── ...
└── README.md
```
