import { requireAdmin } from '@/lib/auth';

/**
 * Guards every administrative route.
 *
 * This layout runs on the server for all nested pages, so an admin check
 * cannot be forgotten on an individual page. Server actions re-check
 * independently, because a layout does not protect a POST.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return <>{children}</>;
}
