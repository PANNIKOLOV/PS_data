'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, LoaderCircle } from 'lucide-react';

import { createShop, updateShop, type ActionState } from '@/app/(app)/admin/shops/actions';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import type { Shop } from '@/lib/supabase/types';

/** A short list covering common shop locations; any IANA name is accepted. */
const COMMON_TIMEZONES = [
  'UTC',
  'Europe/Athens',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Warsaw',
  'Europe/Lisbon',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'PLN', 'SEK', 'NOK', 'DKK', 'CZK', 'RON', 'BGN', 'CAD', 'AUD'];

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? (
        <>
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
          Saving…
        </>
      ) : (
        label
      )}
    </Button>
  );
}

export function ShopForm({ shop }: { shop?: Shop }) {
  const isEdit = Boolean(shop);
  const [state, formAction] = useActionState<ActionState, FormData>(
    isEdit ? updateShop : createShop,
    {},
  );

  return (
    <form action={formAction} className="space-y-5">
      {shop ? <input type="hidden" name="shopId" value={shop.id} /> : null}

      {state.error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-negative-soft px-3 py-2.5 text-xs text-negative"
        >
          <AlertCircle className="mt-px h-4 w-4 shrink-0" aria-hidden />
          <span>{state.error}</span>
        </div>
      ) : null}

      {state.success ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg bg-positive-soft px-3 py-2.5 text-xs text-positive"
        >
          <CheckCircle2 className="mt-px h-4 w-4 shrink-0" aria-hidden />
          <span>{state.success}</span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Shop name" required>
          {(id) => (
            <Input
              id={id}
              name="name"
              defaultValue={shop?.name ?? ''}
              placeholder="Main store"
              required
              maxLength={120}
            />
          )}
        </Field>

        <Field
          label="Shop URL"
          required
          hint="The storefront root, without /api"
        >
          {(id) => (
            <Input
              id={id}
              name="baseUrl"
              defaultValue={shop?.base_url ?? ''}
              placeholder="https://shop.example.com"
              required
              inputMode="url"
            />
          )}
        </Field>

        <Field label="PrestaShop version" required>
          {(id) => (
            <Select id={id} name="psVersion" defaultValue={shop?.ps_version ?? '8'}>
              <option value="1.7">PrestaShop 1.7.x</option>
              <option value="8">PrestaShop 8.x</option>
              <option value="9">PrestaShop 9.x</option>
            </Select>
          )}
        </Field>

        <Field
          label="Default currency"
          required
          hint="Used to display totals; order amounts are converted with each order's rate"
        >
          {(id) => (
            <Select id={id} name="currencyCode" defaultValue={shop?.currency_code ?? 'EUR'}>
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label="Shop timezone"
          required
          hint="PrestaShop stores dates without an offset, so this must match the shop's own setting"
        >
          {(id) => (
            <Select id={id} name="timezone" defaultValue={shop?.timezone ?? 'UTC'}>
              {COMMON_TIMEZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label={isEdit ? 'Webservice key (leave blank to keep current)' : 'Webservice key'}
          required={!isEdit}
          hint="Advanced Parameters → Webservice in the shop back office"
        >
          {(id) => (
            <Input
              id={id}
              name="apiKey"
              type="password"
              autoComplete="off"
              placeholder={isEdit ? '••••••••••••••••' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456'}
              required={!isEdit}
            />
          )}
        </Field>
      </div>

      {isEdit ? (
        <label className="flex items-center gap-2.5 text-sm text-content-primary">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={shop?.is_active ?? true}
            className="h-4 w-4 rounded border-border-strong accent-[var(--accent)]"
          />
          Shop is active
          <span className="text-xs text-content-muted">
            (inactive shops are skipped by scheduled syncs)
          </span>
        </label>
      ) : null}

      <div className="flex gap-2 border-t border-border-subtle pt-4">
        <SubmitButton label={isEdit ? 'Save changes' : 'Connect shop'} />
      </div>
    </form>
  );
}
