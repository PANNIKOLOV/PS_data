import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, Lock } from 'lucide-react';

import { cn } from '@/lib/utils';

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface-inset text-content-muted">
        {icon ?? <Inbox className="h-5 w-5" aria-hidden />}
      </div>
      <p className="text-sm font-medium text-content-primary">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-xs text-content-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/**
 * Shown in place of a widget the viewer's permissions exclude.
 *
 * Naming the restriction is deliberate: a marketer who can see that a figure
 * exists but is withheld knows to ask an admin, rather than assuming the
 * dashboard is broken.
 */
export function RestrictedState({ title }: { title: string }) {
  return (
    <EmptyState
      icon={<Lock className="h-5 w-5" aria-hidden />}
      title={`${title} is not shared with you`}
      description="An administrator controls which figures each shop exposes. Ask them if you need this one."
    />
  );
}

export function ErrorState({ title, description }: { title: string; description?: string }) {
  return (
    <EmptyState
      icon={<AlertTriangle className="h-5 w-5 text-warning" aria-hidden />}
      title={title}
      description={description}
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-md', className)} aria-hidden />;
}
