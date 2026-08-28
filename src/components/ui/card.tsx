import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-(--radius-card) border border-border-subtle bg-surface-card card-shadow',
        className,
      )}
      {...props}
    />
  );
}

// `title` is omitted from the DOM attributes so it can carry a node, not just
// the string an HTML title attribute allows.
interface CardHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

export function CardHeader({ title, description, action, className, ...props }: CardHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b border-border-subtle px-4 py-3.5 sm:px-5',
        className,
      )}
      {...props}
    >
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold text-content-primary">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-xs text-content-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 sm:p-5', className)} {...props} />;
}
