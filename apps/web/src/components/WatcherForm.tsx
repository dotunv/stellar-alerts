'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';

export function WatcherForm({ onWalletAdded }: { onWalletAdded?: () => void }) {
  const [address, setAddress] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const { data: session } = useSession();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('Submitting...');
    
    const accessToken = (session as (typeof session & { accessToken?: string }) | null)?.accessToken;
    if (!accessToken) {
      setStatus('Error: You must be logged in.');
      return;
    }

    try {
      const res = await fetch('http://localhost:3001/wallets', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({ publicKey: address, label: 'Watched Wallet' })
      });
      
      const data = await res.json();
      if (res.ok && data.success) {
        setStatus('Successfully submitted!');
        setAddress('');
        if (onWalletAdded) onWalletAdded();
      } else {
        setStatus(`Error: ${data.error || 'Failed to submit'}`);
      }
    } catch (e) {
      console.error(e);
      setStatus('Network error occurred.');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 border p-6 rounded shadow-md max-w-md mt-6">
      <h2 className="text-xl font-bold">Add Stellar Watcher</h2>
      
      <div className="flex flex-col gap-2">
        <label htmlFor="address" className="text-sm font-semibold">
          Stellar Public Key
        </label>
        <input
          id="address"
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="G..."
          className="border p-2 rounded text-black"
          required
        />
      </div>

      <button
        type="submit"
        className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded w-full"
      >
        Watch Address
      </button>

      {status && <p className="text-sm mt-2 text-gray-600 dark:text-gray-300">{status}</p>}
    </form>
  );
}
