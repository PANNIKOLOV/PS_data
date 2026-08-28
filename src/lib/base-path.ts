/**
 * The sub-path the application is served from, e.g. "/psdata", or "" at the
 * domain root.
 *
 * Next prefixes <Link>, router navigations, redirect() and static assets with
 * basePath on its own. It does NOT touch a plain HTML form action or a URL
 * built by hand, so those few places use this constant.
 *
 * Inlined at build time, like any NEXT_PUBLIC_ value, so it is safe on both
 * the client and the server.
 */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/$/, '');

/** Prefixes an app-absolute path with the base path. */
export function withBasePath(pathname: string): string {
  return `${BASE_PATH}${pathname}`;
}
