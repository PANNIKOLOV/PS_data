/**
 * Phusion Passenger entry point (cPanel "Setup Node.js App").
 *
 * cPanel loads this file instead of running `next start`, so Next is mounted
 * behind its own HTTP server here. The request handler is used rather than a
 * hand-rolled router, which keeps middleware, server actions and the static
 * asset pipeline working exactly as they do under `next start`.
 *
 * Passenger supplies the listening socket, so the port is not ours to choose:
 * `listen('passenger')` is the documented handover. The plain-port branch is
 * only for running this file directly during local testing.
 *
 * Requires a build to exist. Run `npm run build` before restarting the app;
 * Passenger will not build for you, and a missing `.next` directory surfaces
 * as a 503 with a "Could not find a production build" message in stderr.
 */

/* global PhusionPassenger */

const http = require('node:http');
const path = require('node:path');
const next = require('next');

const UNDER_PASSENGER = typeof PhusionPassenger !== 'undefined';

if (UNDER_PASSENGER) {
  // Tell Passenger not to install its own HTTP server; this file provides one.
  PhusionPassenger.configure({ autoInstall: false });
}

// Passenger does not always start the process with the app root as its working
// directory, so the directory is pinned explicitly rather than inferred.
const app = next({ dev: false, dir: __dirname });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    const server = http.createServer((req, res) => {
      handle(req, res).catch((error) => {
        // A rejected handler would otherwise leave the socket hanging open.
        console.error('Unhandled request error:', error);
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      });
    });

    if (UNDER_PASSENGER) {
      server.listen('passenger');
    } else {
      const port = Number(process.env.PORT) || 3000;
      server.listen(port, () => console.log(`Listening on http://localhost:${port}`));
    }
  })
  .catch((error) => {
    // Without this the process exits silently and cPanel shows only a 503.
    console.error('Next.js failed to start. Has `npm run build` been run?');
    console.error(error);
    process.exit(1);
  });
