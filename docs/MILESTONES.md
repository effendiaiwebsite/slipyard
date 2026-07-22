# Milestones (fixed order — check off only, never reorder)

- [x] **M0 — Foundation.** Scaffold, docker-compose, Drizzle + org-scoped
  repository layer + RLS, env.ts, better-auth (email + Google) with TOTP,
  permission matrix + audit_log, shadcn + portal theme shells,
  design-reference acknowledged in CLAUDE.md, CI, seed skeleton, all context
  files. ✅ Fresh clone → `pnpm run setup && pnpm dev`; login with MFA works;
  tenancy-isolation test harness exists.
- [x] **M1 — SaaS shell.** Signup→org creation, Stripe checkout/trial/
  webhooks/grace mode, Customer Portal link, employee invitations (email+SMS),
  role enforcement end-to-end, personal vs firm dashboards (skeleton),
  settings pages. ✅ Two seeded orgs fully isolated; invite→join→MFA→personal
  dashboard flow passes Playwright; subscription lapse flips org read-only.
- [x] **M2 — Client hub.** Clients grid + detail, households, tags, notes,
  contact log, engagements + transitions, workflow board, search, assignment.
  ✅ Firm runs its client list entirely in-app; board drag respects permissions.
- [x] **M3 — Vault & checklists.** S3 pipeline, quarantine/scan, documents,
  checklist engine, intake queue, missing-docs dashboard, Returns page.
  ✅ Upload→scan→assign→auto-advance E2E green against dev bucket.
- [x] **M4 — Client portal.** Magic links + OTP, three-card home, jscanify
  flow, checklist view, trusted helpers, rate limits. ✅ Real-phone flow via
  tunnel; axe checks pass; AAA verified. _(axe AAA green in e2e; real-phone
  tunnel run is queued as a manual item with Satinder — see TESTING.md.)_
- [ ] **M5 — Messaging.** Templates, outbox + Twilio/SES adapters, reminder
  policies via pg-boss, mass send, consent/STOP. ✅ Scheduled reminder fires
  (accelerated clock); real SMS with keys.
- [ ] **M6 — E-signature.** Placement, remote + in-person, stamping + audit
  page, dashboards, notifications. ✅ T183-like PDF draft→sent→signed with
  correct timestamp format; executed PDF immutable.
- [ ] **M7 — CRA authorizations, AFR reconciliation, time & billing (basic),
  reporting.** ✅ Coverage dashboard correct vs seed; AFR compare works from
  pasted CSV; invoice PDF generates.
- [ ] **M8 — AI suite.** AiService + permission-scoped read tools, knowledge
  assistant, email drafts→Messaging drafts, meeting prep, audit risk
  (rules+narrative), optimization advisor, org AI toggle, ai_interaction
  logging. ✅ Assistant answers respect role scoping (clerk test); zero write
  paths from AI proven by test; drafts never auto-send.
- [ ] **M9 — Hardening + generic data import.** §6 checklist with evidence in
  TESTING.md, dependency audit, backup script, retention job,
  tenancy-isolation red-team tests; full import wizard + bulk document
  importer. ✅ All security checks green; messy sample CSV imports with
  correct warnings, custom fields visible, rollback restores clean state.
- [ ] **M10 — Polish + deploy.** Empty/error/loading states, print styles,
  marketing/pricing stub, deployment runbook, final E2E sweep, demo
  walkthrough script. ✅ Walkthrough executes cleanly.
