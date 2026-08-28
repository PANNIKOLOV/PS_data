import { AppShell } from '@/components/layout/app-shell';
import { requireUser } from '@/lib/auth';

/**
 * Shell for every signed-in route.
 *
 * `requireUser` runs on the server for each request, so a page is never
 * rendered for a signed-out visitor even if middleware were bypassed.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return <AppShell profile={user.profile}>{children}</AppShell>;
}
