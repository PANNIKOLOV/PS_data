import { z } from 'zod';

/**
 * Environment contract.
 *
 * Server-only secrets are read lazily through `serverEnv()` so that importing
 * this module from a client component never risks bundling them, and so a
 * missing secret fails loudly at the point of use rather than silently
 * producing a broken request later.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required'),
});

const serverSchema = z.object({
  /*
   * Either a legacy JWT (eyJ…) or a modern secret key (sb_secret_…). Checking
   * the shape catches an unreplaced placeholder here, rather than letting it
   * through to fail on first use as Supabase's "Invalid API key" — which reads
   * as though it were about the PrestaShop key being entered at the time.
   */
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, 'SUPABASE_SERVICE_ROLE_KEY is required')
    .refine(
      (value) => value.startsWith('eyJ') || value.startsWith('sb_secret_'),
      'SUPABASE_SERVICE_ROLE_KEY does not look like a Supabase secret key. Copy the service_role key from Project Settings → API Keys (it starts with "eyJ" or "sb_secret_").',
    ),
  /** 32-byte key, base64 encoded, used to encrypt PrestaShop webservice keys. */
  CREDENTIALS_ENCRYPTION_KEY: z
    .string()
    .min(1, 'CREDENTIALS_ENCRYPTION_KEY is required')
    .refine((value) => {
      try {
        return Buffer.from(value, 'base64').length === 32;
      } catch {
        return false;
      }
    }, 'CREDENTIALS_ENCRYPTION_KEY must be 32 bytes encoded as base64 (openssl rand -base64 32)'),
  /** Shared secret required by the scheduled sync endpoint. Optional in development. */
  SYNC_CRON_SECRET: z.string().min(16).optional(),
});

/**
 * Next.js inlines `process.env.NEXT_PUBLIC_*` at build time only when the
 * property is accessed statically, so these are written out in full.
 *
 * Missing values fail the build rather than the first page view. That is
 * deliberate: these are baked into the client bundle, so a build without them
 * produces an application that looks fine until someone opens it. The raw
 * validation error is replaced with something that names the fix, because it
 * otherwise surfaces as a Zod stack trace inside a webpack chunk.
 */
const parsedPublicEnv = publicSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});

if (!parsedPublicEnv.success) {
  const missing = parsedPublicEnv.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
  throw new Error(
    [
      '',
      'Supabase is not configured.',
      '',
      ...missing,
      '',
      'These two are read at BUILD time, not run time — Next inlines them into',
      'the browser bundle — so they must be set before `npm run build` runs.',
      '',
      'Create a .env.local file in the project root (see .env.example):',
      '',
      '  NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co',
      '  NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable key>',
      '',
      'On shared hosting, prefer .env.local over the control panel environment',
      'editor: panel variables usually reach the running app but not the shell',
      'you build in.',
      '',
    ].join('\n'),
  );
}

export const publicEnv = parsedPublicEnv.data;

let cachedServerEnv: z.infer<typeof serverSchema> | null = null;

export function serverEnv(): z.infer<typeof serverSchema> {
  if (cachedServerEnv) return cachedServerEnv;

  const parsed = serverSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    CREDENTIALS_ENCRYPTION_KEY: process.env.CREDENTIALS_ENCRYPTION_KEY,
    SYNC_CRON_SECRET: process.env.SYNC_CRON_SECRET,
  });

  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `  - ${issue.message}`).join('\n');
    throw new Error(`Server environment is not configured correctly:\n${details}`);
  }

  cachedServerEnv = parsed.data;
  return cachedServerEnv;
}
