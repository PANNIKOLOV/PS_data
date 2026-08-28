'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, LoaderCircle } from 'lucide-react';

import { signIn, type LoginState } from '@/app/login/actions';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="primary" className="w-full" disabled={pending}>
      {pending ? (
        <>
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
          Signing in…
        </>
      ) : (
        'Sign in'
      )}
    </Button>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState<LoginState, FormData>(signIn, {});

  return (
    <form action={formAction} className="space-y-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {state.error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-negative-soft px-3 py-2.5 text-xs text-negative"
        >
          <AlertCircle className="mt-px h-4 w-4 shrink-0" aria-hidden />
          <span>{state.error}</span>
        </div>
      ) : null}

      <Field label="Email address" required>
        {(id) => (
          <Input
            id={id}
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@company.com"
          />
        )}
      </Field>

      <Field label="Password" required>
        {(id) => (
          <Input
            id={id}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="••••••••"
          />
        )}
      </Field>

      <SubmitButton />
    </form>
  );
}
