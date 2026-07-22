import "dotenv/config";
import { Client } from "pg";
import QRCode from "qrcode";
import { OrgScope } from "../src/db/scoped";
import { pool } from "../src/db";
import { env } from "../src/lib/env";
import { mintPortalLink } from "../src/lib/portal-tokens";
import { adminUrl, APP_DB_NAME } from "./db-lib";

/**
 * Manual/tunnel QA helper (M4): mint a real client-portal magic link and
 * watch the outbox for the SMS codes it triggers — the two things a tester
 * can't get on a real handset until the Twilio adapter lands in M5.
 *
 * Everything goes through the SAME code path the staff UI uses
 * (mintPortalLink → OrgScope → outbox), so this exercises the real flow;
 * it only skips the browser click and the authorize() check, which e2e
 * already covers. Dev/test only — refuses to run against production.
 *
 *   pnpm portal:link "Ruth"                 # mint + QR + watch for codes
 *   pnpm portal:link "Ruth" --phone +1416…  # override the texted number
 *   pnpm portal:link --watch                # just watch the outbox
 */

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? "") : null;
};
const watchOnly = args.includes("--watch");
const nameQuery = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--phone");

async function resolveTarget(query: string) {
  // Admin connection for the lookup only (crosses orgs by design, like seed).
  const c = new Client({ connectionString: adminUrl(APP_DB_NAME) });
  await c.connect();
  try {
    const { rows } = await c.query(
      `select c.id, c.org_id, c.display_name, c.phone, o.name as org_name,
              (select m.user_id from org_membership m
                where m.org_id = c.org_id and m.status = 'active'
                order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end
                limit 1) as staff_id
         from client c join org o on o.id = c.org_id
        where c.status = 'active' and c.display_name ilike $1
        order by c.display_name limit 5`,
      [`%${query}%`]
    );
    if (rows.length === 0) throw new Error(`No active client matching “${query}”.`);
    if (rows.length > 1) {
      console.log("Multiple matches — be more specific:");
      for (const r of rows) console.log(`  • ${r.display_name} (${r.org_name})`);
      process.exit(1);
    }
    return rows[0];
  } finally {
    await c.end();
  }
}

/** Poll the outbox and print portal SMS as it lands (the tester's "phone"). */
async function watchOutbox(since: Date) {
  const c = new Client({ connectionString: adminUrl(APP_DB_NAME) });
  await c.connect();
  console.log("\nWatching the outbox for portal texts — Ctrl-C to stop.\n");
  // Dedupe on row id, not timestamp: a `created_at > $last` cursor re-emits
  // the same row whenever the driver's timestamp round-trip loses precision.
  const seen = new Set<string>();
  for (;;) {
    const { rows } = await c.query(
      `select id, body, created_at, meta->>'kind' as kind from outbox
        where channel = 'sms' and meta->>'kind' in ('portal_link','portal_otp')
          and created_at >= $1
        order by created_at`,
      [since]
    );
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      const code = r.body.match(/\b(\d{6})\b/)?.[1];
      const stamp = new Date(r.created_at).toLocaleTimeString("en-CA");
      console.log(
        r.kind === "portal_otp"
          ? `[${stamp}] SECURITY CODE: ${code}`
          : `[${stamp}] link text sent`
      );
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("portal:link is a dev/QA helper — never run it against production.");
  }

  const startedAt = new Date();
  if (!watchOnly) {
    if (!nameQuery) throw new Error('Usage: pnpm portal:link "<client name>" [--phone +1…]');
    const target = await resolveTarget(nameQuery);
    const phone = flag("phone") || target.phone;
    if (!phone) {
      throw new Error(
        `${target.display_name} has no phone on file — pass one: --phone +14165550123`
      );
    }

    const scope = new OrgScope(target.org_id, target.staff_id);
    const { url, token } = await mintPortalLink(scope, {
      clientId: target.id,
      recipientName: target.display_name,
      recipientPhone: phone,
      createdBy: target.staff_id,
    });

    console.log(`\nPortal link for ${target.display_name} (${target.org_name})`);
    console.log(`texted to ${phone} · valid 7 days · dies 15 min after first open`);
    console.log(`token id ${token.id}\n`);
    console.log(await QRCode.toString(url, { type: "terminal", small: true }));
    console.log(`${url}\n`);
    if (env.APP_URL.includes("localhost")) {
      console.log("NOTE: APP_URL is localhost — this link only opens on this machine.");
    }
  }

  await watchOutbox(startedAt);
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await pool.end().catch(() => {});
  process.exit(1);
});
