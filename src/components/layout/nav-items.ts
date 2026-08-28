import type { LucideIcon } from 'lucide-react';
import { Building2, LayoutDashboard, RefreshCw, Settings, Store, Users } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  /** Match nested routes too, e.g. /shops/<id> highlights "Shops". */
  matchPrefix?: boolean;
}

export const MAIN_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/shops', label: 'Shops', icon: Store, matchPrefix: true },
];

export const ADMIN_NAV: NavItem[] = [
  { href: '/admin/shops', label: 'Manage shops', icon: Building2, adminOnly: true, matchPrefix: true },
  { href: '/admin/users', label: 'Users & access', icon: Users, adminOnly: true, matchPrefix: true },
  { href: '/admin/sync', label: 'Sync history', icon: RefreshCw, adminOnly: true },
];

export const FOOTER_NAV: NavItem[] = [
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.matchPrefix) return pathname === item.href || pathname.startsWith(`${item.href}/`);
  return pathname === item.href;
}
