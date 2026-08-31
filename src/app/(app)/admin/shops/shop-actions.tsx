'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, LoaderCircle, PlugZap, RefreshCw, Trash2 } from 'lucide-react';

import {
  deleteShop,
  testShopConnection,
  triggerSync,
  type ActionState,
} from '@/app/(app)/admin/shops/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { describeCadence } from '@/lib/sync-schedule';

function StateMessage({ state }: { state: ActionState }) {
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

function PendingButton({
  idleLabel,
  pendingLabel,
  icon,
  variant = 'secondary',
}: {
  idleLabel: string;
  pendingLabel: string;
  icon: React.ReactNode;
  variant?: 'secondary' | 'primary' | 'danger';
}) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant={variant} size="sm" disabled={pending}>
      {pending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden /> : icon}
      {pending ? pendingLabel : idleLabel}
    </Button>
  );
}

export function ConnectionTester({ shopId }: { shopId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(testShopConnection, {});

  return (
    <div className="space-y-2">
      <form action={formAction}>
        <input type="hidden" name="shopId" value={shopId} />
        <PendingButton
          idleLabel="Test connection"
          pendingLabel="Testing…"
          icon={<PlugZap className="h-3.5 w-3.5" aria-hidden />}
        />
      </form>
      <StateMessage state={state} />
    </div>
  );
}

export function SyncControls({
  shopId,
  intervalMinutes,
  manualLimit,
}: {
  shopId: string;
  intervalMinutes: number;
  manualLimit: number;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(triggerSync, {});

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <form action={formAction}>
          <input type="hidden" name="shopId" value={shopId} />
          <input type="hidden" name="mode" value="incremental" />
          <PendingButton
            idleLabel="Sync new data"
            pendingLabel="Syncing…"
            icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}
            variant="primary"
          />
        </form>

        <form action={formAction}>
          <input type="hidden" name="shopId" value={shopId} />
          <input type="hidden" name="mode" value="full" />
          <PendingButton
            idleLabel="Full resync"
            pendingLabel="Resyncing…"
            icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}
          />
        </form>
      </div>
      <StateMessage state={state} />
      <p className="text-xs text-content-muted">
        A full resync re-reads the shop&apos;s entire order history and can take several minutes on a
        large store. Admin syncs are never rate limited.
      </p>
      <p className="text-xs text-content-muted">
        Scheduled: <span className="text-content-secondary">{describeCadence(intervalMinutes)}</span>{' '}
        · marketers:{' '}
        <span className="text-content-secondary">
          {manualLimit === 0
            ? 'cannot sync by hand'
            : `${manualLimit} ${manualLimit === 1 ? 'sync' : 'syncs'} per day each`}
        </span>
        . Change both under Settings below.
      </p>
    </div>
  );
}

export function DeleteShopControl({ shopId, shopName }: { shopId: string; shopName: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(deleteShop, {});
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <div className="space-y-2">
        <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          Delete shop
        </Button>
        <p className="text-xs text-content-muted">
          Removes the shop, its stored key and every figure synced from it.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-2.5">
      <input type="hidden" name="shopId" value={shopId} />
      <p className="text-xs text-content-secondary">
        Type <span className="font-semibold text-content-primary">{shopName}</span> to confirm. This
        permanently deletes all synced history for the shop.
      </p>
      <Input
        name="confirmName"
        placeholder={shopName}
        autoComplete="off"
        aria-label="Type the shop name to confirm deletion"
        required
      />
      <div className="flex gap-2">
        <PendingButton
          idleLabel="Delete permanently"
          pendingLabel="Deleting…"
          icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}
          variant="danger"
        />
        <Button size="sm" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
      <StateMessage state={state} />
    </form>
  );
}
