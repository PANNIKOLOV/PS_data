import 'server-only';

/**
 * PrestaShop Webservice client.
 *
 * Targets the classic `/api` webservice, which is present and API-compatible
 * across PrestaShop 1.7.8, 8.x and 9.x. Authentication is HTTP Basic with the
 * webservice key as the username and an empty password.
 *
 * Privacy: this client is deliberately built around explicit field selection.
 * `display=[...]` lists are hard-coded in resources.ts and contain no name,
 * email, phone or address fields, so personal data is never transferred over
 * the wire in the first place — not merely dropped after the fact.
 */

export class PrestaShopError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'PrestaShopError';
  }
}

export interface PrestaShopConfig {
  baseUrl: string;
  apiKey: string;
  /** Abort a single request after this many milliseconds. */
  timeoutMs?: number;
}

export interface ListOptions {
  /** Fields to return. Always explicit — never `full`. */
  display: string[];
  /** `filter[field]` entries, e.g. `{ date_add: '[2026-01-01 00:00:00,2026-02-01 00:00:00]' }`. */
  filters?: Record<string, string>;
  /** Set when any filter is a date range; PrestaShop ignores date filters without it. */
  dateFilter?: boolean;
  sort?: string;
  limit?: number;
  offset?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** PrestaShop caps `limit` well below this, but it keeps a runaway loop bounded. */
const MAX_PAGE_SIZE = 500;

export class PrestaShopClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly timeoutMs: number;

  constructor(config: PrestaShopConfig) {
    this.baseUrl = normaliseBaseUrl(config.baseUrl);
    // The webservice key is the username; the password is empty.
    this.authHeader = `Basic ${Buffer.from(`${config.apiKey}:`).toString('base64')}`;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Verifies credentials and reports the PrestaShop version.
   *
   * The webservice returns the version in the `PSWS-Version` response header on
   * every call, which is the most reliable way to identify a shop without
   * needing permissions on any particular resource.
   */
  async testConnection(): Promise<{ version: string | null; resources: string[] }> {
    const { response, body } = await this.request('/api/', { output_format: 'JSON' });

    const version = response.headers.get('psws-version');
    let resources: string[] = [];
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      resources = Object.keys(parsed);
    } catch {
      // Some shops answer the API root with XML regardless of output_format.
      resources = [...body.matchAll(/<(\w+)\s+xlink:href/g)].map((match) => match[1] ?? '');
    }

    return { version, resources: resources.filter(Boolean) };
  }

  /** Fetches a single page of a resource. */
  async list<T>(resource: string, options: ListOptions): Promise<T[]> {
    const params: Record<string, string> = {
      output_format: 'JSON',
      display: `[${options.display.join(',')}]`,
    };

    for (const [field, value] of Object.entries(options.filters ?? {})) {
      params[`filter[${field}]`] = value;
    }
    if (options.dateFilter) params.date = '1';
    if (options.sort) params.sort = options.sort;
    if (options.limit !== undefined) {
      const size = Math.min(options.limit, MAX_PAGE_SIZE);
      params.limit = options.offset !== undefined ? `${options.offset},${size}` : `${size}`;
    }

    const { body } = await this.request(`/api/${resource}`, params);

    // An empty result set comes back as an empty body or `{"<resource>":[]}`.
    if (!body.trim()) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new PrestaShopError(
        `Shop returned a non-JSON response for "${resource}".`,
        undefined,
        'Check that the webservice key has view permission for this resource.',
      );
    }

    const container = (parsed as Record<string, unknown>)[resource];
    if (container === undefined) return [];
    return Array.isArray(container) ? (container as T[]) : [container as T];
  }

  /**
   * Walks every page of a resource.
   *
   * PrestaShop has no cursor or total-count header on list endpoints, so paging
   * continues until a short page is returned.
   */
  async *paginate<T>(
    resource: string,
    options: Omit<ListOptions, 'limit' | 'offset'>,
    pageSize = 200,
  ): AsyncGenerator<T[], void, undefined> {
    const size = Math.min(pageSize, MAX_PAGE_SIZE);
    let offset = 0;

    for (;;) {
      const page = await this.list<T>(resource, { ...options, limit: size, offset });
      if (page.length === 0) return;

      yield page;

      if (page.length < size) return;
      offset += size;
    }
  }

  private async request(
    path: string,
    params: Record<string, string>,
  ): Promise<{ response: Response; body: string }> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Authorization: this.authHeader,
          Accept: 'application/json',
          'User-Agent': 'PS-Data-Analytics/1.0',
        },
        signal: controller.signal,
        cache: 'no-store',
        redirect: 'follow',
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new PrestaShopError(
          `The shop did not respond within ${this.timeoutMs / 1000}s.`,
          undefined,
          'The shop may be slow or unreachable. Try a smaller sync window.',
        );
      }
      throw new PrestaShopError(
        `Could not reach the shop: ${error instanceof Error ? error.message : 'unknown error'}`,
        undefined,
        'Check the shop URL and that the server is reachable from this application.',
      );
    } finally {
      clearTimeout(timeout);
    }

    const body = await response.text();

    if (!response.ok) {
      throw new PrestaShopError(describeHttpError(response.status, body), response.status, hintFor(response.status));
    }

    return { response, body };
  }
}

function normaliseBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new PrestaShopError(`"${rawUrl}" is not a valid shop URL.`);
  }

  // The URL parser is permissive: "ht!tp://not a url" yields the host "ht!tp"
  // rather than throwing. Check the hostname is actually a plausible host so a
  // typo is caught here instead of surfacing later as a confusing fetch error.
  if (!isPlausibleHostname(parsed.hostname)) {
    throw new PrestaShopError(
      `"${rawUrl}" is not a valid shop URL.`,
      undefined,
      'Use the full storefront address, for example https://shop.example.com',
    );
  }

  // Tolerate an /api suffix so both "https://shop.com" and
  // "https://shop.com/api" identify the same shop.
  parsed.pathname = parsed.pathname.replace(/\/api\/?$/i, '/');
  return parsed.toString().replace(/\/+$/, '/');
}

/** Accepts DNS names and IP literals; rejects hosts containing illegal characters. */
function isPlausibleHostname(hostname: string): boolean {
  if (hostname.length === 0 || hostname.length > 253) return false;

  // IPv6 literals arrive from the parser already wrapped in brackets.
  if (hostname.startsWith('[') && hostname.endsWith(']')) return true;

  const labels = hostname.split('.');
  return labels.every((label) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(label));
}

function describeHttpError(status: number, body: string): string {
  const psMessage = extractPrestaShopMessage(body);
  if (psMessage) return `PrestaShop rejected the request (${status}): ${psMessage}`;

  switch (status) {
    case 401:
      return 'Authentication failed (401). The webservice key was not accepted.';
    case 403:
      return 'Access denied (403). The webservice key lacks permission for this resource.';
    case 404:
      return 'Not found (404). The webservice may be disabled for this shop.';
    default:
      return `The shop responded with HTTP ${status}.`;
  }
}

/** PrestaShop wraps API errors in `<errors><error><message>…`, JSON or XML. */
function extractPrestaShopMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { errors?: { message?: string }[] };
    const message = parsed.errors?.[0]?.message;
    if (message) return message;
  } catch {
    // fall through to XML
  }
  return body.match(/<message>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/message>/s)?.[1]?.trim() ?? null;
}

function hintFor(status: number): string | undefined {
  switch (status) {
    case 401:
      return 'In the shop back office open Advanced Parameters → Webservice, confirm the key is enabled and copy it again.';
    case 403:
      return 'Grant the key GET permission on orders, customers, order_states, currencies and shops.';
    case 404:
      return 'Enable Advanced Parameters → Webservice → "Enable PrestaShop Webservice", and make sure URL rewriting is on.';
    default:
      return undefined;
  }
}
