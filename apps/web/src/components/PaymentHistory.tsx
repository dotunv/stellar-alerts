'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { PaymentTable } from './dashboard/PaymentTable';
import { PaymentDTO } from '@stellar-alerts/shared';

export function PaymentHistory({ walletId }: { walletId: string }) {
  const [payments, setPayments] = useState<PaymentDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const { data: session } = useSession();

  useEffect(() => {
    const fetchPayments = async () => {
      setLoading(true);
      try {
        const headers: Record<string, string> = {};
        const accessToken = (session as (typeof session & { accessToken?: string }) | null)?.accessToken;
        if (accessToken) {
          headers['Authorization'] = `Bearer ${accessToken}`;
        }
        
        const res = await fetch(`http://localhost:3001/payments?walletId=${encodeURIComponent(walletId)}`, {
          headers
        });
        
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.payments) {
            setPayments(data.payments);
          }
        }
      } catch (e) {
        console.error('Failed to fetch payments', e);
      } finally {
        setLoading(false);
      }
    };

    if (walletId) {
      fetchPayments();
    }
  }, [walletId, session]);

  if (!walletId) return null;

  return (
    <PaymentTable payments={payments} isLoading={loading} />
  );
}

