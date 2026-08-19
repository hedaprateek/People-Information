/**
 * Entry point for the "Worker with static assets" deployment model.
 *
 * Cloudflare has two ways to host this repo:
 *
 *   Pages project  → functions/_middleware.js runs automatically.
 *   Worker + assets → nothing runs unless a Worker is declared. That is what
 *                     this file and wrangler.jsonc are for, and why the
 *                     dashboard said "Variables cannot be added to a Worker
 *                     that only has static assets".
 *
 * The gate logic lives in functions/_middleware.js and is shared by both, so
 * there is one implementation to reason about. Here `next()` means "fall
 * through to the static file", which on this platform is env.ASSETS.fetch.
 *
 * IMPORTANT: wrangler.jsonc sets assets.run_worker_first = true. Without it
 * Cloudflare serves matching files directly and never calls this Worker —
 * data.xlsx would be downloadable with no code, and the gate would be
 * silently doing nothing.
 */

import { onRequest } from "./functions/_middleware.js";

export default {
  async fetch(request, env, ctx) {
    return onRequest({
      request,
      env,
      ctx,
      next: () => env.ASSETS.fetch(request)
    });
  }
};
