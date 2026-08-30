import type { Metadata } from 'next';
import { BarChart3 } from 'lucide-react';

import { LoginForm } from '@/app/login/login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-page px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="mb-3.5 flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <BarChart3 className="h-5.5 w-5.5" aria-hidden />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-content-primary">PS Data</h1>
          <p className="mt-1 text-sm text-content-muted">
            PrestaShop order analytics
          </p>
        </div>

        <div className="rounded-(--radius-card) border border-border-subtle bg-surface-card p-5 raised-shadow sm:p-6">
          <LoginForm next={next} />
        </div>

        <p className="mt-5 text-center text-xs text-content-muted">
          Accounts are created by an administrator.
        </p>
      </div>
    </main>
  );
}
