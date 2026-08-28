'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, LogOut, Menu, X } from 'lucide-react';

import { SidebarNav } from '@/components/layout/sidebar-nav';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { withBasePath } from '@/lib/base-path';
import { cn, initialsFrom } from '@/lib/utils';
import type { Profile } from '@/lib/supabase/types';

/**
 * Application chrome.
 *
 * Below `lg` the sidebar becomes an overlay drawer; at `lg` and above it is a
 * fixed column. There is one navigation list behind both, so a route only ever
 * needs adding in one place.
 */
export function AppShell({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const isAdmin = profile.role === 'admin';

  // Close the drawer on navigation, otherwise it covers the page just reached.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Escape closes the drawer, and body scroll is locked while it is open.
  useEffect(() => {
    if (!drawerOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen]);

  return (
    <div className="min-h-dvh">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>

      {/* Mobile drawer backdrop */}
      {drawerOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px] lg:hidden"
        />
      ) : null}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[17rem] flex-col border-r border-border-subtle bg-surface-card transition-transform duration-200 lg:translate-x-0',
          drawerOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-hidden={!drawerOpen ? undefined : false}
      >
        <div className="flex h-14 items-center justify-between border-b border-border-subtle px-4">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white">
              <BarChart3 className="h-4 w-4" aria-hidden />
            </span>
            <span className="text-sm font-semibold tracking-tight text-content-primary">PS Data</span>
          </Link>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            className="-mr-1 inline-flex h-9 w-9 items-center justify-center rounded-lg text-content-secondary hover:bg-surface-hover lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-4.5 w-4.5" aria-hidden />
          </button>
        </div>

        <SidebarNav isAdmin={isAdmin} onNavigate={() => setDrawerOpen(false)} />

        <div className="border-t border-border-subtle p-3">
          <div className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5">
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-text"
            >
              {initialsFrom(profile.full_name, profile.email)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-content-primary">
                {profile.full_name || profile.email}
              </p>
              <Badge tone={isAdmin ? 'accent' : 'neutral'} className="mt-0.5">
                {isAdmin ? 'Admin' : 'Marketer'}
              </Badge>
            </div>
            <form action={withBasePath('/auth/signout')} method="post">
              <button
                type="submit"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-content-muted transition-colors hover:bg-surface-hover hover:text-negative"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" aria-hidden />
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="lg:pl-[17rem]">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border-subtle bg-surface-card/85 px-3 backdrop-blur-md sm:px-5">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-content-secondary hover:bg-surface-hover lg:hidden"
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>

          <div className="flex-1" />
          <ThemeToggle />
        </header>

        <main id="main-content" className="px-3 py-4 sm:px-5 sm:py-6 lg:px-7">
          {children}
        </main>
      </div>
    </div>
  );
}
