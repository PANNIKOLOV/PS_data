'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, LoaderCircle, Settings2, UserPlus } from 'lucide-react';

import {
  createUser,
  saveAssignment,
  setUserActive,
  updateUserRole,
  type ActionState,
} from '@/app/(app)/admin/users/actions';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Toggle } from '@/components/ui/field';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import {
  DEFAULT_METRICS,
  METRIC_DESCRIPTIONS,
  METRIC_KEYS,
  METRIC_LABELS,
  type MetricKeyName,
} from '@/lib/permissions';
import type { Shop } from '@/lib/supabase/types';

function Feedback({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="flex items-start gap-1.5 text-xs text-negative">
        <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p role="status" className="flex items-start gap-1.5 text-xs text-positive">
        <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
        {state.success}
      </p>
    );
  }
  return null;
}

function SubmitButton({
  label,
  pendingLabel,
  variant = 'primary',
  size = 'sm',
  icon,
}: {
  label: string;
  pendingLabel: string;
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
}) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant={variant} size={size} disabled={pending}>
      {pending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden /> : icon}
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function CreateUserForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(createUser, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="primary" size="sm" className="h-9" onClick={() => setOpen(true)}>
        <UserPlus className="h-3.5 w-3.5" aria-hidden />
        Add user
      </Button>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader
        title="Add a user"
        description="The account is usable immediately; share the password securely."
      />
      <CardBody>
        <form action={formAction} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Email address" required>
              {(id) => (
                <Input id={id} name="email" type="email" required autoComplete="off" placeholder="marketer@company.com" />
              )}
            </Field>
            <Field label="Full name">
              {(id) => <Input id={id} name="fullName" autoComplete="off" placeholder="Alex Rivera" />}
            </Field>
            <Field label="Role" required>
              {(id) => (
                <Select id={id} name="role" defaultValue="marketer">
                  <option value="marketer">Marketer — sees assigned shops only</option>
                  <option value="admin">Admin — full access to every shop</option>
                </Select>
              )}
            </Field>
            <Field label="Temporary password" required hint="At least 12 characters">
              {(id) => (
                <Input
                  id={id}
                  name="password"
                  type="password"
                  required
                  minLength={12}
                  autoComplete="new-password"
                />
              )}
            </Field>
          </div>

          <Feedback state={state} />

          <div className="flex gap-2 border-t border-border-subtle pt-4">
            <SubmitButton label="Create account" pendingLabel="Creating…" size="md" />
            <Button size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

export function RoleControl({
  userId,
  role,
  isSelf,
}: {
  userId: string;
  role: 'admin' | 'marketer';
  isSelf: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateUserRole, {});

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <Select
        name="role"
        defaultValue={role}
        disabled={isSelf}
        aria-label="Role"
        className="h-8 w-auto min-w-[7.5rem] text-xs"
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        <option value="marketer">Marketer</option>
        <option value="admin">Admin</option>
      </Select>
      <noscript>
        <SubmitButton label="Save" pendingLabel="…" variant="secondary" />
      </noscript>
      <Feedback state={state} />
    </form>
  );
}

export function ActiveControl({
  userId,
  isActive,
  isSelf,
}: {
  userId: string;
  isActive: boolean;
  isSelf: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(setUserActive, {});

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="isActive" value={String(!isActive)} />
      <Button
        type="submit"
        size="sm"
        variant={isActive ? 'secondary' : 'primary'}
        disabled={isSelf}
        title={isSelf ? 'You cannot deactivate your own account' : undefined}
      >
        {isActive ? 'Deactivate' : 'Reactivate'}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

/**
 * Per-shop access and metric visibility for one marketer.
 *
 * The metric toggles are the answer to "what should this person see for this
 * shop": each corresponds to one dashboard widget, and the same keys are
 * enforced in the database by `can_view_metric`.
 */
export function ShopAccessEditor({
  userId,
  shop,
  hasAccess,
  metrics,
}: {
  userId: string;
  shop: Shop;
  hasAccess: boolean;
  metrics: MetricKeyName[];
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveAssignment, {});
  const [enabled, setEnabled] = useState(hasAccess);
  const [selected, setSelected] = useState<Set<MetricKeyName>>(
    () => new Set(hasAccess ? metrics : DEFAULT_METRICS),
  );

  const toggleMetric = (key: MetricKeyName, next: boolean) => {
    setSelected((previous) => {
      const updated = new Set(previous);
      if (next) updated.add(key);
      else updated.delete(key);
      return updated;
    });
  };

  return (
    <form action={formAction} className="rounded-lg border border-border-subtle p-3.5">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="shopId" value={shop.id} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            name="hasAccess"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="h-4 w-4 rounded border-border-strong accent-[var(--accent)]"
          />
          <span>
            <span className="block text-sm font-medium text-content-primary">{shop.name}</span>
            <span className="block text-xs text-content-muted">
              {new URL(shop.base_url).hostname}
            </span>
          </span>
        </label>

        <SubmitButton
          label="Save"
          pendingLabel="Saving…"
          icon={<Settings2 className="h-3.5 w-3.5" aria-hidden />}
        />
      </div>

      {enabled ? (
        <fieldset className="mt-3 border-t border-border-subtle pt-3">
          <legend className="sr-only">Metrics visible for {shop.name}</legend>
          <p className="mb-1.5 text-xs font-medium text-content-secondary">
            Visible figures ({selected.size} of {METRIC_KEYS.length})
          </p>
          <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
            {METRIC_KEYS.map((key) => (
              <Toggle
                key={key}
                name={`metric:${key}`}
                checked={selected.has(key)}
                onChange={(next) => toggleMetric(key, next)}
                label={METRIC_LABELS[key]}
                description={METRIC_DESCRIPTIONS[key]}
              />
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="mt-2">
        <Feedback state={state} />
      </div>
    </form>
  );
}
