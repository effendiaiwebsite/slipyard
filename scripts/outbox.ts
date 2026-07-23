import "dotenv/config";
import { Client } from "pg";
import { adminUrl, APP_DB_NAME } from "./db-lib";

/**
 * Dev outbox viewer: in outbox mode (the dev default) NOTHING is really
 * sent — invitation emails, portal SMS, reminders all land as rows in the
 * outbox table. This prints them, newest first, so a tester can grab the
 * invite/portal links and codes that would have been emailed/texted.
 *
 *   pnpm outbox              # latest 10
 *   pnpm outbox --limit 25
 *   pnpm outbox --watch      # tail new rows as they land (Ctrl-C to stop)
 */

const args = process.argv.slice(2);
const watch = args.includes("--watch");
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? Math.max(1, Number(args[limitIdx + 1]) || 10) : 10;

type Row = {
  id: string;
  channel: string;
  to_address: string;
  subject: string | null;
  body: string;
  status: string;
  provider: string | null;
  error: string | null;
  kind: string | null;
  org_name: string;
  created_at: Date;
};

function print(r: Row) {
  const stamp = new Date(r.created_at).toLocaleString("en-CA", { hour12: false });
  const head = `[${stamp}] ${r.channel.toUpperCase()} → ${r.to_address} · ${r.org_name} · ${r.status}${r.provider ? ` (${r.provider})` : ""}${r.kind ? ` · ${r.kind}` : ""}`;
  console.log("─".repeat(Math.min(head.length, 100)));
  console.log(head);
  if (r.subject) console.log(`Subject: ${r.subject}`);
  if (r.error) console.log(`ERROR: ${r.error}`);
  console.log(r.body.trim());
  const link = r.body.match(/https?:\/\/\S+/)?.[0];
  if (link) console.log(`\n➜ link: ${link}`);
  console.log();
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("outbox viewer is a dev/QA helper — never run it against production.");
  }
  const c = new Client({ connectionString: adminUrl(APP_DB_NAME) });
  await c.connect();
  try {
    const query = (extra: string, params: unknown[]) =>
      c.query<Row>(
        `select ob.id, ob.channel, ob.to_address, ob.subject, ob.body, ob.status,
                ob.provider, ob.error, ob.meta->>'kind' as kind, o.name as org_name, ob.created_at
           from outbox ob join org o on o.id = ob.org_id
          ${extra} order by ob.created_at desc limit $1`,
        params
      );

    const { rows } = await query("", [limit]);
    for (const r of [...rows].reverse()) print(r);
    if (rows.length === 0) console.log("Outbox is empty.");

    if (!watch) return;
    console.log("Watching for new outbox rows — Ctrl-C to stop.\n");
    const seen = new Set(rows.map((r) => r.id));
    for (;;) {
      await new Promise((r) => setTimeout(r, 1500));
      const { rows: fresh } = await query("", [25]);
      for (const r of [...fresh].reverse()) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        print(r);
      }
    }
  } finally {
    if (!watch) await c.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
