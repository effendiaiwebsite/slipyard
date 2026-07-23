# Demo walkthrough (M10)

_A scripted ~20-minute tour of the product on the deterministic seed. Run
`pnpm db:reset` (or `pnpm db:seed` on a fresh DB) first so every number
below matches. Dev logins all use password `demo-password-123`; first login
forces TOTP enrollment — have an authenticator app ready. Steps marked
**[phone]** need a real handset (use a Cloudflare quick tunnel as in
TESTING.md); everything else runs on localhost._

Every step here is covered by the automated suite (the matching spec is
noted), so a clean `pnpm test:e2e` run is the machine-checked version of
this script.

## 1. First impressions (2 min)

1. Open `/` — the marketing page: what it is, flat **$300/month per firm**,
   trial CTA. _(m10.spec)_
2. Sign in as **joey@lakesidecpa.test** (owner). Point out mandatory TOTP —
   there is no way to skip enrollment. _(auth.spec)_
3. **Dashboard**: live counts — active clients, open engagements, awaiting
   documents/signature, out-for-signature, authorization coverage, and
   **Documents outstanding** (missing required items across returns; click
   through to Returns). _(m10.spec)_

## 2. Clients & workflow (3 min)

4. **Clients** → open **Ruth Okafor**: masked SIN (last 3 only — the full
   number is AES-encrypted and never rendered), household links, pinned
   note, contact log, engagement pipeline with stage transitions.
   _(m2.spec)_
5. **Workflow board**: drag a card between stages; cards the viewer can't
   transition show a lock. Stage columns are the org's own (Settings →
   Workflow stages — rename/reorder live). _(m2.spec)_

## 3. Documents, checklists, intake (3 min)

6. On Ruth's page: upload any small PDF → watch it scan (quarantine →
   ClamAV → vault) and land with an "In vault" badge; download is a
   short-lived presigned link. _(m3.spec)_
7. Her 2025 T1 checklist shows required items still missing — mark one
   "Got it" and the return auto-advances when complete. _(m3.spec)_
8. **Document intake**: the front-desk queue — unfiled uploads waiting to be
   attached to a return; **/app/documents/bulk** drag-drops many files for
   one client through the same scanned pipeline. _(m3/m9.spec)_

## 4. Client portal (3 min) [phone]

9. On Ruth's page, **Portal access** → issue a link (or a trusted-helper
   link — name + relationship). The SMS goes via the outbox in dev; grab
   the link with `pnpm portal:link`. _(m4.spec)_
10. Open it **[phone]**: big-type welcome → SMS code → three-card home.
    "What we still need" mirrors the checklist in plain language; "Send us
    a document" runs the guided camera capture — page outline live,
    auto-capture when steady, drag-the-corners fix-up on review. The upload
    appears on staff side with a "Portal" badge and checks its item off.
    _(m4.spec; capture extras are M10)_
11. Revoke the link and show the live portal session dies with it.
    _(m4.spec)_

## 5. Messaging & reminders (2 min)

12. **Messaging**: mass-send a templated reminder filtered to
    awaiting-docs; preview shows per-client variable substitution and
    reachability (Hélène is opted out of SMS — STOP is honored
    everywhere). The send log records every recipient. _(m5.spec)_
13. Settings → Templates: the reminder policy card — automatic nudges for
    stale awaiting-docs returns, cadence-capped. _(m5.spec)_

## 6. E-signature (3 min)

14. On Ruth's engagement letter PDF: **Request signature** → the editor
    shows the REAL rendered page (pdf.js, M10) — drop a signature and date
    field exactly where they belong. _(m10/m6.spec)_
15. **Sign in person now** → draw or type the signature → the executed PDF
    is a NEW immutable object with a CRA-format timestamp and an appended
    audit page; the source is untouched. _(m6.spec)_
16. Remote flow: the request rides the portal — same big-type treatment.
    _(m4/m6 specs)_

## 7. Tax-office tooling (3 min)

17. **CRA authorizations**: coverage dashboard from the seed — every state
    (active, pending, expiring soon, expired-in-effect, revoked, none).
    _(m7.spec)_
18. **AFR reconciliation**: paste the sample CRA slip CSV → on-file /
    missing / untracked verdicts; one-click "Track on checklist".
    _(m7.spec)_
19. **Time & billing**: record an entry for Ruth → invoice all her WIP →
    the PDF renders on demand; per-org invoice numbering. _(m7.spec)_
20. **Reports**: the practice rollup — pipeline, client mix, coverage,
    billing. Print it (M10 print styles strip the chrome). _(m7.spec)_

## 8. AI suite (2 min)

21. **Knowledge assistant**: ask "How does the pipeline look?" — the answer
    is scoped to the asker (demo as sam@ to show an assigned-only view;
    it's a different, smaller answer). Drafts-only posture: the AI never
    writes or sends. _(m8.spec)_
22. **Email drafts**: draft for Ruth → grounded in her actual missing
    items → edit → the explicit "Send via Messaging" is the ONLY send
    path. _(m8.spec)_
23. Settings → **AI usage** (M10): every run logged — who, which read
    tools, tokens. _(m10.spec)_

## 9. Import & administration (2 min)

24. Settings → **Data import**: "Load sample" runs the deliberately messy
    CSV — mapping suggestions, per-row warnings, custom columns, SIN
    encrypted at staging; commit, show the client, then **Undo this
    import**. _(m9.spec)_
25. Settings → **Retention review** (7-year posture) and **Employees**
    (roles, invitations). _(m9/m1 specs)_
26. Sign out; sign in as **priya@lakesidecpa.test** (clerk): the
    **front-desk dashboard** (M10) — intake queue, documents outstanding,
    portal uploads, quick actions — and note clerks see all clients but
    every mutation path is permission-gated. _(m10/m2 specs)_

## Isolation encore (30 s, if asked)

27. Sign in as **nina@northerntax.test** — org 2 sees none of Lakeside's
    data; the red-team suite (tests/redteam.test.ts) proves the same at
    the SQL layer.
