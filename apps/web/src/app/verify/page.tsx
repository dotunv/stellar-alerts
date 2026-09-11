'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import Link from 'next/link';

function VerifyContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>(token ? 'verifying' : 'error');
  const [errorMessage, setErrorMessage] = useState(token ? '' : 'Missing authentication token in URL.');

  useEffect(() => {
    if (!token) return;

    let isMounted = true;

    async function verify() {
      try {
        const res = await signIn('credentials', {
          token,
          redirect: false,
        });

        if (res?.ok) {
          if (isMounted) {
            setStatus('success');
            setTimeout(() => {
              router.push('/');
            }, 1200);
          }
        } else {
          if (isMounted) {
            setStatus('error');
            setErrorMessage('Invalid or expired magic link. Please request a new one.');
          }
        }
      } catch (err: unknown) {
        console.error('Verification error:', err);
        if (isMounted) {
          setStatus('error');
          setErrorMessage('Could not connect to authentication service.');
        }
      }
    }

    verify();

    return () => {
      isMounted = false;
    };
  }, [token, router]);

  return (
    <div className="w-full max-w-md bg-[#0a0a14]/90 backdrop-blur-2xl border border-white/10 rounded-3xl p-10 shadow-[0_0_80px_rgba(0,0,0,0.8)] text-center relative overflow-hidden">
      {/* Background ambient glow */}
      <div className="absolute top-0 right-0 w-40 h-40 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none"></div>

      {status === 'verifying' && (
        <div className="space-y-6 animate-in fade-in duration-500">
          <div className="relative flex items-center justify-center mx-auto w-20 h-20">
            <div className="absolute inset-0 rounded-full border-2 border-cyan-500/20 animate-ping"></div>
            <div className="w-16 h-16 rounded-full border-3 border-cyan-500 border-t-transparent animate-spin flex items-center justify-center"></div>
            <div className="absolute w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center text-white">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight">Verifying Magic Link</h2>
            <p className="text-gray-400 text-sm mt-2">Authenticating your session securely with StellarAlerts...</p>
          </div>
        </div>
      )}

      {status === 'success' && (
        <div className="space-y-6 animate-in zoom-in-95 duration-500">
          <div className="w-20 h-20 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mx-auto text-emerald-400 shadow-[0_0_40px_rgba(16,185,129,0.3)]">
            <svg className="w-10 h-10 animate-in zoom-in duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight">Authenticated!</h2>
            <p className="text-gray-300 text-sm mt-2">Welcome back! Redirecting to your dashboard...</p>
          </div>

          <div className="pt-2 flex justify-center">
            <div className="w-6 h-6 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin"></div>
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="space-y-6 animate-in fade-in duration-500">
          <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mx-auto text-red-400">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>

          <div>
            <h2 className="text-xl font-bold text-white">Verification Failed</h2>
            <p className="text-gray-400 text-xs mt-2 leading-relaxed">{errorMessage}</p>
          </div>

          <Link
            href="/"
            className="inline-block w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-sm shadow-lg transition-all"
          >
            Return to Home
          </Link>
        </div>
      )}
    </div>
  );
}

export default function VerifyPage() {
  return (
    <div className="min-h-screen bg-[#030307] flex items-center justify-center p-6 relative overflow-hidden">
      {/* Background ambient glow */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[30%] left-[30%] w-[40vw] h-[40vw] rounded-full bg-cyan-600/15 blur-[160px] mix-blend-screen"></div>
        <div className="absolute bottom-[20%] right-[20%] w-[35vw] h-[35vw] rounded-full bg-blue-600/15 blur-[160px] mix-blend-screen"></div>
      </div>

      <Suspense
        fallback={
          <div className="w-full max-w-md bg-[#0a0a14] border border-white/10 rounded-3xl p-10 text-center">
            <div className="w-10 h-10 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="text-gray-400 text-sm mt-4">Loading verification...</p>
          </div>
        }
      >
        <VerifyContent />
      </Suspense>
    </div>
  );
}
