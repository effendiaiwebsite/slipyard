# Deployment runbook

_M10. Written for the first production deployment (Joey's two-practice firm)
and reusable for any single-instance install. The app is one Next.js server +
Postgres + S3 + ClamAV; pg-boss runs inside the Next process
(instrumentation.ts) — no separate worker to deploy._

---

## CHOSEN STACK — all-AWS in ca-central-1 (post-M10 decision)

Everything Canadian: compute + database + files + encryption + email all in
**ca-central-1 (Montreal)**, satisfying the "data stored in Canada" promise
for a product holding SINs and tax data. The `deploy/` directory automates the
server side; the AWS-console provisioning is below. (The generic §0–8 further
down remains valid as background; this section is the concrete path.)

**Architecture**
- **Compute**: one **Lightsail** instance (Ubuntu, ca-central-1) running the
  Next.js app (systemd) + **ClamAV** co-located + **Caddy** for auto-HTTPS.
- **Database**: **RDS Postgres** (ca-central-1). Its automated backups + PITR
  are the DB backup story — `pnpm backup` becomes optional belt-and-suspenders.
- **Storage/crypto/email**: existing **S3 + KMS + SES**, already ca-central-1.
- Tenant isolation needs **no separate DB role** here: FORCE row-level security
  + the per-request `app.org_id` GUC enforce it regardless of the connecting
  role, so the app uses the RDS master user directly (see `slipyard.env.example`).

**The `deploy/` kit**
- `deploy/setup-server.sh` — one-shot server bootstrap (Node 22, pnpm, ClamAV
  on 127.0.0.1:3310, Caddy, app clone, systemd unit, env skeleton, 2 GB swap).
- `deploy/deploy.sh` — pull → install → build → migrate → restart (every deploy).
- `deploy/slipyard.service` — systemd unit (runs `next start` as user `slipyard`).
- `deploy/Caddyfile` — reverse proxy + automatic HTTPS.
- `deploy/slipyard.env.example` — production env template → `/etc/slipyard/slipyard.env`.

### Step-by-step

1. **RDS Postgres** (ca-central-1): create a PostgreSQL 16 instance
   (`db.t4g.micro` is fine to start), database name `slipyard`, in your
   default VPC, **not publicly accessible**. Note the endpoint + master
   user/password → they become `DATABASE_URL` / `DATABASE_ADMIN_URL`. Keep
   automated backups on (7–35 days).
2. **Lightsail instance** (ca-central-1): Ubuntu 22.04/24.04, at least the
   **4 GB plan** (Next's build + ClamAV's in-memory virus DB need the room;
   the 2 GB plan works only with the swap the script adds). Attach a **static
   IP**. In the Lightsail firewall, allow **22, 80, 443** only.
3. **Networking Lightsail → RDS**: enable **Lightsail VPC peering** (Lightsail
   → Account → Advanced → "VPC peering" for ca-central-1), then edit the RDS
   security group to allow inbound **5432 from the Lightsail private IP range**.
   (Alternative: make RDS public and restrict its SG to the Lightsail static
   IP — simpler, slightly less private.)
4. **Bootstrap the server** (SSH in as `ubuntu`):
   ```bash
   sudo bash <(curl -fsSL https://raw.githubusercontent.com/effendiaiwebsite/slipyard/main/deploy/setup-server.sh)
   ```
   (If the repo is private, `git clone` it to `/opt/slipyard` first, then
   `sudo bash /opt/slipyard/deploy/setup-server.sh`.)
5. **Fill in secrets**: `sudo nano /etc/slipyard/slipyard.env` — RDS URL, the
   existing AWS keys + `S3_BUCKET` + `KMS_KEY_ID`, `SES_FROM_ADDRESS`
   (`notifications@slipyard.ca`), **live** Stripe keys, Twilio, fresh
   `AUTH_SECRET` + `FIELD_ENCRYPTION_KEY` (`openssl rand -base64 32`). Back up
   `FIELD_ENCRYPTION_KEY` — losing it makes every stored SIN unreadable.
6. **First deploy** (runs migrations against RDS, does NOT seed):
   ```bash
   sudo -u slipyard bash /opt/slipyard/deploy/deploy.sh
   ```
7. **DNS**: in Cloudflare, point `slipyard.ca` + `www` **A records** at the
   Lightsail static IP, **DNS-only (grey cloud)** so Caddy can issue TLS. Within
   a minute or two `https://slipyard.ca` is live.
8. **Webhooks + residency finish**: set the Stripe live webhook and the Twilio
   messaging webhook to `https://slipyard.ca/api/webhooks/...`; request **SES
   production access** if not already granted. Consider moving S3 to a
   dedicated production bucket (dev is `accountant-crm-dev`).

### Redeploys after this
Push to GitHub, then on the server: `sudo -u slipyard bash /opt/slipyard/deploy/deploy.sh`.
(Or add a GitHub Action later to run that over SSH on push to `main`.)

---

## 0. Shape of a production install

- **App**: one Node host (or container) running `pnpm build` output via
  `pnpm start`, behind a TLS-terminating reverse proxy. Single instance —
  the portal rate limiter is in-memory (documented limitation; move to
  Postgres/Redis before scaling out).
- **Postgres 16+** (managed is fine). Two credentials:
  - an admin/owner login used ONLY for migrations (`DATABASE_ADMIN_URL`),
  - the runtime `crm_app` role (`DATABASE_URL`) — non-superuser, subject to
    FORCEd RLS. Never point the app at the admin login: RLS is the
    defense-in-depth layer and superusers bypass it.
- **S3, ca-central-1** — versioned private bucket + KMS key (below).
- **ClamAV** — the official `clamav/clamav` container reachable on :3310
  from the app host (`CLAMAV_HOST`/`CLAMAV_PORT`). Uploads NEVER skip the
  scan; if clamd is down, uploads park as scan_failed (retryable), so treat
  ClamAV as a tier-1 service.

## 1. Provision

1. **Postgres**: create the database; create the `crm_app` role with a
   strong password (see `scripts/db-lib.ts` for the dev-time SQL shape).
2. **Migrate**: `DATABASE_ADMIN_URL=... DATABASE_URL=... pnpm db:migrate`
   — runs `drizzle/` in order, including the hand-written RLS layers. Do NOT
   seed production (`scripts/seed.ts` is fictional dev data).
3. **S3**: bucket in `ca-central-1`, versioning ON, all public access
   blocked. Create a **KMS key** (`KMS_KEY_ID`) and set it as the bucket's
   default encryption (dev ran with S3-managed keys; production uses KMS —
   the app passes `KMS_KEY_ID` on uploads when set).
   - IAM user/role for the app: Get/Put/Delete/List scoped to this bucket
     only (mirror the dev `accountant-crm-dev-app` inline policy) + `ses:Send*`
     if using SES via the same credentials.
   - Add a **lifecycle rule** expiring `backups/` objects per your backup
     retention (e.g. 90 days); vault objects under `org/` have NO lifecycle
     expiry — retention is 7 years by posture (ADR-0034).
4. **ClamAV**: run `clamav/clamav:stable` adjacent to the app; give it
   outbound access for freshclam updates; healthcheck `PING` on 3310.
5. **Domain + TLS**: pick the public hostname → set `APP_URL=https://...`
   (portal magic links, Stripe/Twilio callbacks, and CSP all derive from
   being same-origin behind this URL).

## 2. Environment

Copy `.env.example`, then set — everything below is validated fail-fast by
`src/lib/env.ts` at boot:

| Var | Production value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `crm_app` connection string |
| `DATABASE_ADMIN_URL` | admin login (migrations only; may live only in CI) |
| `AUTH_SECRET`, `FIELD_ENCRYPTION_KEY` | fresh `openssl rand -base64 32` each — losing FIELD_ENCRYPTION_KEY loses every stored SIN, so store it in a secrets manager with the DB backups' recovery docs |
| `APP_URL` | the public https URL |
| `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` | **live-mode** keys |
| `STRIPE_PRICE_ID` | live $300/month price (create in the live dashboard; ADR-0012) |
| `STRIPE_WEBHOOK_SECRET` | from step 3 below |
| `AWS_*`, `S3_BUCKET`, `KMS_KEY_ID` | from §1.3 |
| `CLAMAV_HOST` / `CLAMAV_PORT` | from §1.4 |
| `TWILIO_*` | the live Twilio credentials (all three together) |
| `EMAIL_MODE=ses` + `SES_FROM_ADDRESS` | firm-domain address, see §4 |
| `JOBS_ENABLED` | `true` (leave `REMINDER_SWEEP_INTERVAL_MS` unset — prod uses the */5 cron) |
| `ANTHROPIC_API_KEY` | set to enable real AI; per-org toggle still governs |
| `GOOGLE_CLIENT_ID/SECRET` | only if offering Google sign-in — add the prod redirect URI in Google console |
| `SENTRY_DSN`, `LOG_LEVEL` | optional; `info` |

## 3. Stripe (live)

1. Create the live Product + $300/month Price → `STRIPE_PRICE_ID`.
2. Add a webhook endpoint `https://<host>/api/webhooks/stripe` with the
   events the handler consumes (checkout.session.completed,
   customer.subscription.*, invoice.paid, invoice.payment_failed) → copy the
   signing secret to `STRIPE_WEBHOOK_SECRET`.
3. Configure the Customer Portal in live mode (cancel/update payment).
4. Smoke: new org signup → checkout with a real card → trial/active state
   lands on the org; subscription cancel flips grace mode.

## 4. Email deliverability (SES) — do this EARLY, approvals take days

Verified state as of 2026-07-22: the AWS account is in the **SES sandbox**
and the test identity was a gmail.com address — both must change before real
client email (PROGRESS "Email deliverability").

1. **Verify the firm's own domain** in SES (ca-central-1) → publish the
   three DKIM CNAMEs it issues.
2. **SPF**: add `include:amazonses.com` to the domain's TXT.
3. **DMARC**: publish `_dmarc` TXT (start `p=none; rua=mailto:...`, tighten
   after volume looks clean).
4. Optional but recommended: custom MAIL FROM subdomain (e.g.
   `mail.firmdomain.ca`).
5. **Request production access** (SES → Account dashboard → Request) —
   describe transactional practice mail; modest volumes.
6. Set `SES_FROM_ADDRESS` to an address AT THE FIRM DOMAIN (never gmail).
7. Warm up: send to firm-internal addresses first; watch bounce/complaint
   metrics for the first weeks.

## 5. Twilio

1. Point the messaging webhook for the firm's number at
   `https://<host>/api/webhooks/twilio` (POST). Signature validation is
   already enforced (X-Twilio-Signature against `APP_URL`).
2. Smoke: text STOP to the firm number from a personal phone → the client
   row shows "No texts (STOP)" and inbound is logged on the contact
   timeline; START re-enables.
3. Delivery-status callbacks are NOT wired (known limitation) — use the
   Twilio console for carrier-level forensics.

## 6. Backups & scheduled jobs

The app schedules its own in-process jobs (document-scan, message-send,
reminders-sweep cron */5). The two OS-level schedules you must add:

| What | Command | Cadence |
| --- | --- | --- |
| DB backup → S3 | `PG_DUMP=<path> pnpm backup` | nightly |
| Orphaned-S3 sweep | `pnpm s3:cleanup` (review) / `--apply` | monthly, or after any org deletion |

- `pnpm backup` needs pg_dump 16+ on the host (`PG_DUMP` overrides the
  binary path) and writes `backups/` locally then to
  `s3://$S3_BUCKET/backups/<db>/` — the bucket lifecycle rule from §1.3 is
  the retention policy. `--dry-run` prints a redacted plan.
- **Restore drill** (do once before go-live): `pg_restore` the latest dump
  into a scratch database, boot the app against it read-only, confirm a
  client page + a document download work. A backup that's never been
  restored is a hope, not a backup.

## 7. Go-live smoke test (after DNS + TLS)

Run through `docs/WALKTHROUGH.md` end-to-end on production with a throwaway
org, plus:

1. Fresh signup → checkout (live card) → TOTP enrollment forced.
2. Upload a document → lands `clean` in the vault (proves S3 + KMS +
   ClamAV).
3. Issue a portal link to a staff phone → OTP → photograph a receipt →
   upload appears with the Portal badge (proves Twilio + APP_URL + portal
   pipeline).
4. Send a template email to a firm address (proves SES production +
   DKIM: check the received headers for `dkim=pass`).
5. E-sign a one-page PDF in person → executed PDF downloads (proves
   pdf pipeline + storage).
6. `pnpm backup` once by hand; confirm the object in S3.
7. Delete the throwaway org; run `pnpm s3:cleanup` (dry-run) and confirm it
   lists exactly that org's prefix, then `--apply`.

## 8. Update procedure

1. `git pull` → `pnpm install` (postinstall re-copies /public/vendor).
2. `pnpm db:migrate` with the admin URL (migrations are additive; RLS files
   are part of the chain — never run them by hand).
3. `pnpm build` → restart the server. In-flight pg-boss jobs are re-picked
   up; the scan pipeline retries scan_failed docs on demand.
