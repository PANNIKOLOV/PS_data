import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { PrestaShopClient, PrestaShopError } from '@/lib/prestashop/client';

/**
 * Exercises the client against a stub that mimics the PrestaShop Webservice:
 * Basic auth with an empty password, `display=[...]` field selection, offset
 * pagination, the PSWS-Version header, and PrestaShop's error envelopes.
 */

const API_KEY = 'TESTKEY1234567890TESTKEY123456';

/** Requests the stub saw, so tests can assert on what was actually sent. */
let requestLog: { path: string; auth: string | undefined }[] = [];

/** Total orders the stub pretends to hold; paged in blocks of `limit`. */
let orderCount = 0;

/** Overrides the next response, for error-path tests. */
let nextResponse: { status: number; body: string; contentType?: string } | null = null;

function startStub(): Promise<Server> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    requestLog.push({ path: url.pathname + url.search, auth: request.headers.authorization });

    if (nextResponse) {
      const override = nextResponse;
      nextResponse = null;
      response.writeHead(override.status, {
        'Content-Type': override.contentType ?? 'application/json',
        'PSWS-Version': '8.1.6',
      });
      response.end(override.body);
      return;
    }

    // The webservice key is the username; the password is empty.
    const expected = `Basic ${Buffer.from(`${API_KEY}:`).toString('base64')}`;
    if (request.headers.authorization !== expected) {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ errors: [{ code: 58, message: 'Invalid authentication key' }] }));
      return;
    }

    const headers = { 'Content-Type': 'application/json', 'PSWS-Version': '8.1.6' };

    if (url.pathname === '/api/' || url.pathname === '/api') {
      response.writeHead(200, headers);
      response.end(
        JSON.stringify({ orders: {}, customers: {}, order_states: {}, currencies: {}, shops: {} }),
      );
      return;
    }

    if (url.pathname === '/api/orders') {
      const [offsetRaw, sizeRaw] = (url.searchParams.get('limit') ?? '0,100').split(',');
      const offset = Number(offsetRaw ?? 0);
      const size = Number(sizeRaw ?? offsetRaw ?? 100);

      const orders = [];
      for (let index = offset; index < Math.min(offset + size, orderCount); index += 1) {
        orders.push({
          id: String(index + 1),
          reference: `REF${index + 1}`,
          total_paid: '10.00',
          date_add: '2026-03-01 10:00:00',
        });
      }

      response.writeHead(200, headers);
      response.end(JSON.stringify({ orders }));
      return;
    }

    if (url.pathname === '/api/order_states') {
      response.writeHead(200, headers);
      response.end(
        JSON.stringify({
          order_states: [
            {
              id: '2',
              // Multi-language shops return an array of translations.
              name: [
                { id: '1', value: 'Payment accepted' },
                { id: '2', value: 'Paiement accepté' },
              ],
              paid: '1',
            },
          ],
        }),
      );
      return;
    }

    if (url.pathname === '/api/empty') {
      response.writeHead(200, headers);
      response.end('');
      return;
    }

    response.writeHead(404, headers);
    response.end(JSON.stringify({ errors: [{ code: 404, message: 'Resource not found' }] }));
  });

  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

let server: Server;
let baseUrl: string;

before(async () => {
  server = await startStub();
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

function client(key = API_KEY) {
  return new PrestaShopClient({ baseUrl, apiKey: key, timeoutMs: 5000 });
}

describe('connection test', () => {
  it('authenticates and reports the shop version', async () => {
    requestLog = [];
    const result = await client().testConnection();

    assert.equal(result.version, '8.1.6');
    assert.ok(result.resources.includes('orders'));
    assert.ok(result.resources.includes('customers'));
  });

  it('sends the key as the Basic auth username with an empty password', async () => {
    requestLog = [];
    await client().testConnection();

    const [entry] = requestLog;
    const decoded = Buffer.from(entry!.auth!.replace('Basic ', ''), 'base64').toString();
    assert.equal(decoded, `${API_KEY}:`);
  });

  it('surfaces the shop message on a bad key', async () => {
    await assert.rejects(
      () => client('WRONGKEY').testConnection(),
      (error: unknown) => {
        assert.ok(error instanceof PrestaShopError);
        assert.equal(error.status, 401);
        assert.match(error.message, /Invalid authentication key/);
        // The hint should point at where to fix it.
        assert.match(error.hint ?? '', /Webservice/);
        return true;
      },
    );
  });

  it('carries the requested URL and response body for diagnostics', async () => {
    await assert.rejects(
      () => client('WRONGKEY').testConnection(),
      (error: unknown) => {
        assert.ok(error instanceof PrestaShopError);
        assert.match(error.url ?? '', /\/api\/\?output_format=JSON$/);
        assert.match(error.bodySnippet ?? '', /Invalid authentication key/);
        return true;
      },
    );
  });

  it('exposes the API root it will call', () => {
    assert.equal(
      new PrestaShopClient({ baseUrl: 'https://shop.example.com/myshop', apiKey: API_KEY }).apiRoot,
      'https://shop.example.com/myshop/api/',
    );
  });
});

describe('listing', () => {
  it('requests only the fields it was given', async () => {
    orderCount = 3;
    requestLog = [];
    await client().list('orders', { display: ['id', 'total_paid', 'date_add'] });

    const [entry] = requestLog;
    assert.match(entry!.path, /display=%5Bid%2Ctotal_paid%2Cdate_add%5D/);
    assert.match(entry!.path, /output_format=JSON/);
    // display=full would pull personal data along with everything else.
    assert.ok(!entry!.path.includes('full'));
  });

  it('adds date=1 when a date filter is present, as PrestaShop requires', async () => {
    orderCount = 1;
    requestLog = [];
    await client().list('orders', {
      display: ['id'],
      filters: { date_add: '[2026-01-01 00:00:00,2026-02-01 00:00:00]' },
      dateFilter: true,
    });

    assert.match(requestLog[0]!.path, /date=1/);
    assert.match(requestLog[0]!.path, /filter%5Bdate_add%5D/);
  });

  it('returns an empty array for an empty body', async () => {
    const result = await client().list('empty', { display: ['id'] });
    assert.deepEqual(result, []);
  });

  it('normalises a single object into an array', async () => {
    nextResponse = { status: 200, body: JSON.stringify({ orders: { id: '1' } }) };
    const result = await client().list<{ id: string }>('orders', { display: ['id'] });
    assert.equal(result.length, 1);
    assert.equal(result[0]!.id, '1');
  });

  it('reads multilingual fields as sent by a multi-language shop', async () => {
    const states = await client().list<{ name: { id: string; value: string }[] }>('order_states', {
      display: ['id', 'name'],
    });
    assert.ok(Array.isArray(states[0]!.name));
    assert.equal(states[0]!.name[0]!.value, 'Payment accepted');
  });

  it('explains a non-JSON response instead of throwing a parse error', async () => {
    nextResponse = { status: 200, body: '<html>maintenance</html>', contentType: 'text/html' };
    await assert.rejects(
      () => client().list('orders', { display: ['id'] }),
      (error: unknown) => {
        assert.ok(error instanceof PrestaShopError);
        assert.match(error.message, /non-JSON/);
        return true;
      },
    );
  });

  it('reads PrestaShop XML error envelopes too', async () => {
    nextResponse = {
      status: 403,
      body: '<?xml version="1.0"?><prestashop><errors><error><message><![CDATA[Access denied]]></message></error></errors></prestashop>',
      contentType: 'text/xml',
    };
    await assert.rejects(
      () => client().list('orders', { display: ['id'] }),
      (error: unknown) => {
        assert.ok(error instanceof PrestaShopError);
        assert.match(error.message, /Access denied/);
        return true;
      },
    );
  });
});

describe('pagination', () => {
  it('walks every page and stops on a short one', async () => {
    orderCount = 25;
    requestLog = [];

    const collected: { id: string }[] = [];
    for await (const page of client().paginate<{ id: string }>('orders', { display: ['id'] }, 10)) {
      collected.push(...page);
    }

    assert.equal(collected.length, 25);
    assert.equal(collected[0]!.id, '1');
    assert.equal(collected[24]!.id, '25');
    // 3 pages: 10 + 10 + 5, the short page ending the walk.
    assert.equal(requestLog.length, 3);
    assert.match(requestLog[0]!.path, /limit=0%2C10/);
    assert.match(requestLog[1]!.path, /limit=10%2C10/);
  });

  it('stops immediately when the first page is empty', async () => {
    orderCount = 0;
    requestLog = [];

    const collected = [];
    for await (const page of client().paginate('orders', { display: ['id'] }, 10)) {
      collected.push(...page);
    }

    assert.equal(collected.length, 0);
    assert.equal(requestLog.length, 1);
  });

  it('makes exactly one extra call when the total is a multiple of the page size', async () => {
    // 20 records at 10 per page cannot be known to be finished until an empty page.
    orderCount = 20;
    requestLog = [];

    const collected = [];
    for await (const page of client().paginate('orders', { display: ['id'] }, 10)) {
      collected.push(...page);
    }

    assert.equal(collected.length, 20);
    assert.equal(requestLog.length, 3);
  });
});

describe('url handling', () => {
  it('accepts a base URL that already ends in /api', async () => {
    const withSuffix = new PrestaShopClient({ baseUrl: `${baseUrl}/api`, apiKey: API_KEY });
    requestLog = [];
    await withSuffix.testConnection();
    assert.match(requestLog[0]!.path, /^\/api\//);
  });

  it('tolerates a trailing slash', async () => {
    const withSlash = new PrestaShopClient({ baseUrl: `${baseUrl}/`, apiKey: API_KEY });
    requestLog = [];
    await withSlash.testConnection();
    assert.match(requestLog[0]!.path, /^\/api\//);
  });

  it('keeps the path of a shop installed in a subfolder', async () => {
    // A shop at https://domain/myshop must be queried at /myshop/api/…, not
    // /api/ at the domain root — `new URL(path, base)` would have dropped it.
    const subfolder = new PrestaShopClient({ baseUrl: `${baseUrl}/myshop`, apiKey: API_KEY });
    requestLog = [];
    await subfolder.testConnection().catch(() => {
      /* the stub serves nothing under /myshop, only the request path matters */
    });
    assert.match(requestLog[0]!.path, /^\/myshop\/api\//);
  });

  it('keeps a subfolder even when the URL also ends in /api', async () => {
    const subfolder = new PrestaShopClient({ baseUrl: `${baseUrl}/myshop/api`, apiKey: API_KEY });
    requestLog = [];
    await subfolder.testConnection().catch(() => {});
    assert.match(requestLog[0]!.path, /^\/myshop\/api\//);
  });

  it('rejects a URL that cannot be parsed', () => {
    assert.throws(
      () => new PrestaShopClient({ baseUrl: 'ht!tp://not a url', apiKey: API_KEY }),
      PrestaShopError,
    );
  });
});

describe('timeouts', () => {
  it('gives a clear message rather than hanging', async () => {
    const slowServer = createServer(() => {
      /* never responds */
    });
    await new Promise<void>((resolve) => slowServer.listen(0, '127.0.0.1', resolve));
    const port = (slowServer.address() as AddressInfo).port;

    const slowClient = new PrestaShopClient({
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: API_KEY,
      timeoutMs: 300,
    });

    await assert.rejects(
      () => slowClient.testConnection(),
      (error: unknown) => {
        assert.ok(error instanceof PrestaShopError);
        assert.match(error.message, /did not respond/);
        return true;
      },
    );

    slowServer.close();
  });
});

describe('hostname validation', () => {
  const cases: [string, boolean][] = [
    ['https://shop.example.com', true],
    ['shop.example.com', true],
    ['http://localhost:8080', true],
    ['https://192.168.1.10', true],
    ['https://my-shop.co.uk', true],
    ['ht!tp://not a url', false],
    ['https://sh op.com', false],
    ['https://shop_underscore.com', false],
  ];

  for (const [input, shouldAccept] of cases) {
    it(`${shouldAccept ? 'accepts' : 'rejects'} ${input}`, () => {
      const build = () => new PrestaShopClient({ baseUrl: input, apiKey: API_KEY });
      if (shouldAccept) assert.doesNotThrow(build);
      else assert.throws(build, PrestaShopError);
    });
  }
});
