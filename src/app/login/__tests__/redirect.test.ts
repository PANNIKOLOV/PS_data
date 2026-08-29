import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * Mirrors safeRedirectPath from ../actions.ts. That module is a server action
 * ('use server'), so it cannot be imported into a plain test process; the rule
 * it encodes is small and worth pinning regardless.
 */
const SIGN_IN_DESTINATIONS = [
  '/dashboard',
  '/shops',
  '/settings',
  '/admin/shops',
  '/admin/users',
  '/admin/sync',
] as const;

function safeRedirectPath(value: string | undefined): string {
  if (!value) return '/dashboard';
  if (!value.startsWith('/') || value.startsWith('//')) return '/dashboard';
  const [pathname] = value.split(/[?#]/) as [string];
  const allowed = SIGN_IN_DESTINATIONS.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
  return allowed ? value : '/dashboard';
}

describe('post-login destination', () => {
  it('honours a real application route', () => {
    assert.equal(safeRedirectPath('/dashboard'), '/dashboard');
    assert.equal(safeRedirectPath('/admin/users'), '/admin/users');
    assert.equal(safeRedirectPath('/settings'), '/settings');
  });

  it('honours nested routes and keeps their query string', () => {
    assert.equal(safeRedirectPath('/shops/abc-123'), '/shops/abc-123');
    assert.equal(
      safeRedirectPath('/shops/abc-123?period=last_30_days'),
      '/shops/abc-123?period=last_30_days',
    );
  });

  it('falls back to the dashboard for a path this deployment does not serve', () => {
    // A bookmark from a sub-path deployment, or browser autocomplete.
    assert.equal(safeRedirectPath('/psdata/dashboard'), '/dashboard');
    assert.equal(safeRedirectPath('/psdata'), '/dashboard');
    assert.equal(safeRedirectPath('/nope'), '/dashboard');
  });

  it('refuses to leave the site', () => {
    assert.equal(safeRedirectPath('//evil.example.com'), '/dashboard');
    assert.equal(safeRedirectPath('https://evil.example.com'), '/dashboard');
    assert.equal(safeRedirectPath('http://evil.example.com/dashboard'), '/dashboard');
  });

  it('is not fooled by a prefix that only looks like a route', () => {
    assert.equal(safeRedirectPath('/dashboard-evil'), '/dashboard');
    assert.equal(safeRedirectPath('/shopsX'), '/dashboard');
  });

  it('defaults when absent or empty', () => {
    assert.equal(safeRedirectPath(undefined), '/dashboard');
    assert.equal(safeRedirectPath(''), '/dashboard');
  });
});
