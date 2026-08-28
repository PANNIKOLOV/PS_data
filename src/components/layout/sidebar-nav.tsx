'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ADMIN_NAV, FOOTER_NAV, MAIN_NAV, isActive, type NavItem } from '@/components/layout/nav-items';
import { cn } from '@/lib/utils';

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = isActive(pathname, item);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-accent-soft text-accent-text'
          : 'text-content-secondary hover:bg-surface-hover hover:text-content-primary',
      )}
    >
      <Icon className="h-4.5 w-4.5 shrink-0" aria-hidden />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function NavSection({
  heading,
  items,
  onNavigate,
}: {
  heading?: string;
  items: NavItem[];
  onNavigate?: () => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-1">
      {heading ? (
        <p className="px-2.5 pt-4 pb-1 text-[0.6875rem] font-semibold tracking-wider text-content-muted uppercase">
          {heading}
        </p>
      ) : null}
      {items.map((item) => (
        <NavLink key={item.href} item={item} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

export function SidebarNav({
  isAdmin,
  onNavigate,
}: {
  isAdmin: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3" aria-label="Main">
      <NavSection items={MAIN_NAV} onNavigate={onNavigate} />
      {isAdmin ? (
        <NavSection heading="Administration" items={ADMIN_NAV} onNavigate={onNavigate} />
      ) : null}
      <div className="mt-auto pt-4">
        <NavSection items={FOOTER_NAV} onNavigate={onNavigate} />
      </div>
    </nav>
  );
}
