import type { InputHTMLAttributes, LabelHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { forwardRef, useId } from 'react';

import { cn } from '@/lib/utils';

const CONTROL_CLASSES =
  'w-full rounded-lg border border-border-strong bg-surface-card px-3 text-sm text-content-primary ' +
  'placeholder:text-content-muted transition-colors ' +
  'hover:border-accent/40 disabled:cursor-not-allowed disabled:opacity-60';

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('block text-xs font-medium text-content-secondary', className)}
      {...props}
    />
  );
}

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: (controlId: string) => ReactNode;
}

/**
 * Wraps a control with its label, hint and error, wiring up the ids so screen
 * readers announce all three together.
 */
export function Field({ label, hint, error, required, children }: FieldProps) {
  const controlId = useId();

  return (
    <div className="space-y-1.5">
      <Label htmlFor={controlId}>
        {label}
        {required ? <span className="ml-0.5 text-negative">*</span> : null}
      </Label>
      {children(controlId)}
      {error ? (
        <p id={`${controlId}-error`} className="text-xs text-negative">
          {error}
        </p>
      ) : hint ? (
        <p id={`${controlId}-hint`} className="text-xs text-content-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(CONTROL_CLASSES, 'h-10', className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(CONTROL_CLASSES, 'h-10 cursor-pointer appearance-none pr-9', className)}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 0.65rem center',
          backgroundSize: '1rem',
        }}
        {...props}
      />
    );
  },
);

/** Accessible switch built on a real checkbox, so it works without JavaScript. */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  name,
  disabled,
}: {
  checked: boolean;
  onChange?: (next: boolean) => void;
  label: string;
  description?: string;
  name?: string;
  disabled?: boolean;
}) {
  const id = useId();

  return (
    <label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-lg p-2.5 transition-colors',
        disabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-surface-hover',
      )}
    >
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          id={id}
          name={name}
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange?.(event.target.checked)}
        />
        <span
          aria-hidden
          className={cn(
            'block h-5 w-9 rounded-full transition-colors',
            'bg-border-strong peer-checked:bg-accent',
            'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
          )}
        />
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform',
            checked && 'translate-x-4',
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-content-primary">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs text-content-muted">{description}</span>
        ) : null}
      </span>
    </label>
  );
}
