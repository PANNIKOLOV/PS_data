#!/usr/bin/env node
/**
 * Runs `next build` with NODE_ENV pinned to production.
 *
 * Some hosts (cPanel's Node.js selector among them) export a NODE_ENV of their
 * own into the shell. When it is anything but "production", the build compiles,
 * typechecks and collects page data, then fails on the last step:
 *
 *   Error: <Html> should not be imported outside of pages/_document.
 *   Export encountered an error on /_error: /404, exiting the build.
 *
 * Nothing in that message mentions NODE_ENV, so it reads as an application bug.
 * A build is production by definition, so the value is set here rather than
 * left to the environment — and it cannot be set from .env.local, because an
 * existing environment value takes precedence.
 *
 * Spawned as a child process because Next reads NODE_ENV as its own module
 * graph loads; setting it in-process after that would be too late.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let nextBin;
try {
  nextBin = require.resolve('next/dist/bin/next');
} catch {
  console.error('Could not find the Next.js CLI. Run `npm install` first.');
  process.exit(1);
}

const previous = process.env.NODE_ENV;
if (previous && previous !== 'production') {
  console.log(`Overriding NODE_ENV="${previous}" with "production" for this build.`);
}

/*
 * Cap the Rust toolchain's thread pool too.
 *
 * `experimental.cpus` limits the workers Next spawns, but Next's Rust parts
 * (SWC, Lightning CSS) build their own rayon pool sized to the visible CPU
 * count. On a host with a per-user process cap that allocation is refused and
 * the build aborts mid-run:
 *
 *   The global thread pool has not been initialized.: ThreadPoolBuildError
 *   { kind: IOError(Os { code: 11, message: "Resource temporarily unavailable" }) }
 *
 * Worse than a clean failure, it leaves .next half-written, so a previously
 * working deployment starts returning "Could not find a production build".
 *
 * Measured at no cost on a 4-core machine (33s against 35s), so it is set by
 * default rather than kept as a fallback. An explicit value is respected.
 */
const threadEnv = process.env.RAYON_NUM_THREADS
  ? {}
  : { RAYON_NUM_THREADS: '1' };

const child = spawn(process.execPath, [nextBin, 'build'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production', ...threadEnv },
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Build terminated by signal ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error('Could not start the build:', error.message);
  process.exit(1);
});
