# Progress

_Last updated: 2026-07-21 (M2 complete + customizable workflow stages)_

## DONE
- **M0 — Foundation** (commit `M0: ...`): scaffold, RLS + OrgScope, better-auth
  with mandatory TOTP, permission matrix + audit, shells, tests, CI, docs.
- **M1 — SaaS shell** (commit `M1: ...`): signup→firm creation, Stripe
  checkout/trial/webhooks/grace mode (flat $300/firm — ADR-0012, live-verified),
  Customer Portal, invitations (outbox email+SMS, hashed tokens), employees
  settings, role dashboards, settings pages.
- **M2 — Client hub** (this commit):
  - Schema + FORCEd RLS: client (SIN AES-256-GCM via crypto.ts + sin_last3
    for mask-only display, custom_fields jsonb, tags[], preferred_channel,
    assigned accountant), household, engagement (7-status pipeline
    ADR-0013, status_timestamps, assignee), client_note (pinned),
    contact_log. Deterministic seed: 10 Lakeside clients (2 households,
    2 encrypted SINs, corp + trust), 9 engagements across every board
    column, notes + contact history, 1 isolation client in org 2.
  - OrgScope methods: listClientsWithMeta (assignee/household names + latest
    engagement + last contact merged), detail (household members, notes,
    contacts, engagements), CRUD, households, notes/pin, contact log,
    engagements (create/transition/assign/countByStatus).
  - Permissions: new `engagements.create` action (accountant=assigned,
    clerk=deny); all mutations via authorize() with resource assignment;
    server actions return denials as friendly messages (tryAuthorize) —
    still audited. Accountant assigned_only view-scoping enforced in grid,
    detail (404, no existence leak), board, dashboards (viewAssignedOnlyFilter).
  - UI: clients grid (TanStack Table — search, type filter, archived toggle,
    sortable, stage badges, owner, last contact), client detail (masked SIN,
    household links, pinned-note callout, notes, contact log, engagement
    transitions + assignment), new/edit forms (SIN validated Luhn +
    encrypted server-side, never echoed), workflow kanban (HTML5 drag,
    optimistic move, permission-locked cards with lock icon, firm/mine
    filter), dashboards wired to real client/engagement counts by stage.
  - Tests: 49 Vitest (12 new in clients.test.ts) + 9 Playwright (4 new in
    m2.spec.ts). e2e TOTP secrets now persist across spec files
    (e2e/.totp-secrets.json, cleared each run); auth rate limit 300/min
    outside production (ADR-0014).

- **Post-M2: customizable workflow stages (ADR-0015, customer request)**:
  engagement_status enum → per-org engagement_stage rows (immutable key,
  label, fixed category, position). Default 7-stage template at org
  bootstrap/seed/backfill. Settings → Workflow stages (owner/admin): rename,
  reorder, add, delete-with-reassign (min 2 stages). Board columns, detail
  transitions, grid badges, dashboard counts all follow org stages; automation
  hooks (M3+) must key on stage.category only. 54 Vitest + 10 Playwright.

## IN PROGRESS
- Nothing — stopped at the M2 boundary (plus the stage-customization
  follow-up above).

## KNOWN BUGS / LIMITATIONS
- Google-only accounts still can't enroll TOTP (twoFactor.enable needs a
  password). Candidate fix in a later milestone: better-auth setPassword
  path for OAuth-only accounts.
- Multi-org users still land in their first org (switcher deferred).
- checkout.session.completed relies on client_reference_id; sessions created
  outside the app are ignored by design.
- Clients grid filters/search run client-side on the org's full (scoped)
  list — fine at small-firm scale; move search server-side if a firm's list
  grows past a few thousand.
- Households are created inline from the client form; there's no dedicated
  household management page (rename/merge) yet.

## NEEDS SATINDER'S / JOEY'S REVIEW
- ADR-0004 accountant_scope_mode default (carried over from M0).
- ~~ADR-0013 stage names~~ RESOLVED by ADR-0015: stages are per-org editable
  (Settings → Workflow stages); Joey tunes his own template.

## NEXT 3 CONCRETE STEPS (M3 — Vault & checklists)
1. S3 pipeline (ca-central-1 + KMS, org/{orgId}/quarantine|vault keys),
   presigned POST with type/25MB caps, ClamAV scan job, promote/flag flow —
   needs Docker or a dev bucket + local clamd (ADR-0007 revisit).
2. document + checklist_item tables (+ RLS), checklist engine seeded from
   engagement type, intake queue UI (clerk documents.intake_upload path).
3. Missing-docs dashboard + Returns page; auto-advance engagement to
   awaiting_docs/in_preparation on checklist state changes.
