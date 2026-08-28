import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CURRENCY_FIELDS,
  CUSTOMER_FIELDS,
  FORBIDDEN_FIELDS,
  ORDER_FIELDS,
  ORDER_STATE_FIELDS,
} from '@/lib/prestashop/resources';

/**
 * The application's privacy promise is that personal data is never requested
 * from PrestaShop. That promise lives entirely in these field lists, so it is
 * asserted here rather than left to review.
 */
describe('privacy boundary', () => {
  const selections: Record<string, readonly string[]> = {
    orders: ORDER_FIELDS,
    customers: CUSTOMER_FIELDS,
    order_states: ORDER_STATE_FIELDS,
    currencies: CURRENCY_FIELDS,
  };

  for (const [resource, fields] of Object.entries(selections)) {
    it(`requests no personal fields from ${resource}`, () => {
      const leaked = fields.filter((field) =>
        FORBIDDEN_FIELDS.includes(field as (typeof FORBIDDEN_FIELDS)[number]),
      );
      assert.deepEqual(leaked, [], `${resource} would transfer personal data: ${leaked.join(', ')}`);
    });
  }

  it('never asks the webservice for every field', () => {
    // `display=full` would pull names, emails and addresses along with it.
    for (const fields of Object.values(selections)) {
      assert.ok(!fields.includes('full'), 'display=full must never be used');
    }
  });

  it('keeps the pseudonymous customer link but no identifying detail', () => {
    assert.ok(ORDER_FIELDS.includes('id_customer'), 'needed for new-versus-returning analysis');
    assert.ok(!ORDER_FIELDS.includes('id_address_delivery' as never));
    assert.ok(!ORDER_FIELDS.includes('id_address_invoice' as never));
  });
});
