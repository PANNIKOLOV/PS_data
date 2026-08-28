import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { ShopForm } from '@/app/(app)/admin/shops/shop-form';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardBody } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Connect a shop' };

export default function NewShopPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/admin/shops"
        className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-content-muted transition-colors hover:text-content-primary"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Manage shops
      </Link>

      <PageHeader
        title="Connect a shop"
        description="The connection is verified before anything is saved."
      />

      <Card className="mb-4">
        <CardBody className="text-xs text-content-secondary">
          <p className="mb-2 font-medium text-content-primary">
            Before you start, in the shop&apos;s back office:
          </p>
          <ol className="list-decimal space-y-1 pl-4">
            <li>
              Open <span className="font-medium">Advanced Parameters → Webservice</span> and enable
              the webservice.
            </li>
            <li>Add a new key, and copy it.</li>
            <li>
              Grant that key <span className="font-medium">GET (view)</span> permission on{' '}
              <span className="font-mono text-[0.7rem]">orders</span>,{' '}
              <span className="font-mono text-[0.7rem]">customers</span>,{' '}
              <span className="font-mono text-[0.7rem]">order_states</span> and{' '}
              <span className="font-mono text-[0.7rem]">currencies</span>. No write permissions are
              needed.
            </li>
          </ol>
          <p className="mt-2.5 text-content-muted">
            Only order totals, dates and status are read. Customer names, emails, phone numbers and
            addresses are never requested.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <ShopForm />
        </CardBody>
      </Card>
    </div>
  );
}
