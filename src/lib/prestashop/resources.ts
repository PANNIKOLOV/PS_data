import 'server-only';

/**
 * Field selections for every resource we read.
 *
 * These lists are the privacy boundary of the whole application. PrestaShop's
 * `orders` and `customers` resources expose names, email addresses, phone
 * numbers and address ids; none of those appear below, so they are never
 * requested and never transit the network.
 *
 * `id_customer` is kept because order counts per buyer (new versus returning)
 * are meaningless without it. It is a shop-local integer with no meaning
 * outside the source shop, and it is never joined to any identifying record.
 */

export const ORDER_FIELDS = [
  'id',
  'reference',
  'id_customer',
  'current_state',
  'payment',
  'module',
  'valid',
  'id_currency',
  'conversion_rate',
  'total_paid',
  'total_paid_real',
  'total_products',
  'total_shipping_tax_incl',
  'total_discounts_tax_incl',
  'date_add',
  'date_upd',
] as const;

export const CUSTOMER_FIELDS = [
  'id',
  'date_add',
  'newsletter',
  'optin',
  'active',
  'is_guest',
] as const;

export const ORDER_STATE_FIELDS = ['id', 'name', 'color', 'paid', 'shipped', 'deleted'] as const;

export const CURRENCY_FIELDS = ['id', 'iso_code', 'conversion_rate'] as const;

/** Fields PrestaShop must never be asked for. Enforced by a unit test. */
export const FORBIDDEN_FIELDS = [
  'firstname',
  'lastname',
  'email',
  'phone',
  'phone_mobile',
  'address1',
  'address2',
  'city',
  'postcode',
  'dni',
  'vat_number',
  'birthday',
  'company',
  'id_address_delivery',
  'id_address_invoice',
  'note',
  'ip_registration_newsletter',
] as const;

/** Raw shapes as they arrive from the webservice, before normalisation. */
export interface RawOrder {
  id: number | string;
  reference?: string;
  id_customer?: number | string;
  current_state?: number | string;
  payment?: string;
  module?: string;
  valid?: number | string | boolean;
  id_currency?: number | string;
  conversion_rate?: number | string;
  total_paid?: number | string;
  total_paid_real?: number | string;
  total_products?: number | string;
  total_shipping_tax_incl?: number | string;
  total_discounts_tax_incl?: number | string;
  date_add?: string;
  date_upd?: string;
}

export interface RawCustomer {
  id: number | string;
  date_add?: string;
  newsletter?: number | string | boolean;
  optin?: number | string | boolean;
  active?: number | string | boolean;
  is_guest?: number | string | boolean;
}

export type LocalisedValue = string | { id: number | string; value: string }[];

export interface RawOrderState {
  id: number | string;
  name?: LocalisedValue;
  color?: string;
  paid?: number | string | boolean;
  shipped?: number | string | boolean;
  deleted?: number | string | boolean;
}

export interface RawCurrency {
  id: number | string;
  iso_code?: string;
  conversion_rate?: number | string;
}
