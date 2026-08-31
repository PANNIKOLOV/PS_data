'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, LoaderCircle, PlugZap } from 'lucide-react';

import {
  createShop,
  diagnoseShopConnection,
  updateShop,
  type ActionState,
  type DiagnosisState,
} from '@/app/(app)/admin/shops/actions';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { MANUAL_SYNC_LIMITS, SYNC_CADENCES } from '@/lib/sync-schedule';
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

/**
 * Submits the same form to the diagnostic action instead of save.
 *
 * `formNoValidate` lets a connection be tested from just the URL and key,
 * before the rest of the form is filled in; the action checks those two
 * itself. `useFormStatus` exposes which action a pending submission targets,
 * so only the button that was pressed shows its spinner.
 */
function TestConnectionButton({ action }: { action: (formData: FormData) => void }) {
  const status = useFormStatus();
  const testing = status.pending && status.action === action;

  return (
    <Button type="submit" formAction={action} formNoValidate disabled={status.pending}>
      {testing ? (
        <>
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
          Testing…
        </>
      ) : (
        <>
          <PlugZap className="h-4 w-4" aria-hidden />
          Test connection
        </>
      )}
    </Button>
  );
}

/** The raw facts of a connection attempt, shown exactly as observed. */
function DiagnosisReport({ diagnosis }: { diagnosis: DiagnosisState }) {
  if (!diagnosis.status) return null;

  const isOk = diagnosis.status === 'ok';

  return (
    <div
      role={isOk ? 'status' : 'alert'}
      className={
        isOk
          ? 'space-y-2 rounded-lg bg-positive-soft px-3 py-2.5 text-xs text-positive'
          : 'space-y-2 rounded-lg bg-negative-soft px-3 py-2.5 text-xs text-negative'
      }
    >
      <p className="flex items-start gap-2 font-medium">
        {isOk ? (
          <CheckCircle2 className="mt-px h-4 w-4 shrink-0" aria-hidden />
        ) : (
          <AlertCircle className="mt-px h-4 w-4 shrink-0" aria-hidden />
        )}
        <span>{diagnosis.message}</span>
      </p>
      {diagnosis.hint ? <p className="pl-6">{diagnosis.hint}</p> : null}
      {diagnosis.report ? (
        <dl className="space-y-1.5 rounded-md bg-surface-card/60 p-2.5 text-content-secondary">
          {diagnosis.report.map((row) => (
            <div key={row.label}>
              <dt className="text-[0.6875rem] font-medium tracking-wide text-content-muted uppercase">
                {row.label}
              </dt>
              <dd className="mt-0.5 font-mono text-[0.6875rem] break-all text-content-primary">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

export function ShopForm({ shop }: { shop?: Shop }) {
  const isEdit = Boolean(shop);
  const [state, formAction] = useActionState<ActionState, FormData>(
    isEdit ? updateShop : createShop,
    {},
  );
  const [diagnosis, diagnoseAction] = useActionState<DiagnosisState, FormData>(
    diagnoseShopConnection,
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

      <fieldset className="space-y-4 border-t border-border-subtle pt-5">
        <legend className="sr-only">Sync schedule</legend>
        <div>
          <h3 className="text-sm font-semibold text-content-primary">Sync schedule</h3>
          <p className="mt-0.5 text-xs text-content-muted">
            How often this shop refreshes on its own, and how many times a marketer may refresh it
            by hand.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Automatic sync frequency"
            required
            hint="Runs on the scheduled job; a shorter interval means more requests to the shop"
          >
            {(id) => (
              <Select
                id={id}
                name="syncIntervalMinutes"
                defaultValue={String(shop?.sync_interval_minutes ?? 1440)}
              >
                {SYNC_CADENCES.map((cadence) => (
                  <option key={cadence.minutes} value={cadence.minutes}>
                    {cadence.label} · {cadence.description}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Marketer syncs per day"
            required
            hint="Counted per marketer, per day, in the shop's timezone. Admins are never limited."
          >
            {(id) => (
              <Select
                id={id}
                name="manualSyncDailyLimit"
                defaultValue={String(shop?.manual_sync_daily_limit ?? 5)}
              >
                {MANUAL_SYNC_LIMITS.map((limit) => (
                  <option key={limit} value={limit}>
                    {limit === 0
                      ? 'Not allowed'
                      : `${limit} ${limit === 1 ? 'sync' : 'syncs'} per day`}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </fieldset>

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

      <DiagnosisReport diagnosis={diagnosis} />

      <div className="flex flex-wrap gap-2 border-t border-border-subtle pt-4">
        <SubmitButton label={isEdit ? 'Save changes' : 'Connect shop'} />
        <TestConnectionButton action={diagnoseAction} />
      </div>
    </form>
  );
}
