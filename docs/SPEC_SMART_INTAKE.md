# Build spec — Smart intake (client questionnaires in the portal)

_Status: SPEC ONLY — approved for design 2026-07-23, NOT scheduled. Build as
M12 (after SPEC_STRIPE_PAYMENTS) when the current debugging pass is done.
Nothing in this document is implemented._

## TL;DR (customer-approved 2026-07-23)

Portal questionnaires: one big-type question per screen with simple
branching, upload questions that reuse the existing capture pipeline and
satisfy checklist items, and a staff review surface where answers are
drafts — field changes apply only on explicit staff approval (same posture
as AI and import). SIN questions are rejected by the template validator
outright.

## Goal

Staff send a client a questionnaire ("2026 personal tax organizer") that the
client answers in the portal — one question per screen, big type, branching —
and the answers land as a staff review surface that can create/satisfy
checklist items and propose client-record updates. Competitive context: this
is the TaxDome-organizer / Canopy-Smart-Intake gap; nobody does it in an
account-less, elderly-friendly portal (docs/COMPETITIVE notes, 2026-07).

## Non-goals (v1)

- Asking for SIN or any field we treat as secret. The template editor
  refuses such questions outright (see Sensitive data).
- E-signing the completed organizer (M6 covers signatures; combine later).
- AI-generated templates or AI summaries of submissions (clean later add —
  both read-only, no posture change; listed under Phase 2).
- Household multi-person questionnaires (one intake = one client; a trusted
  helper answering via their own link already works through M4 scoping).
- PDF export of the completed intake (print styles suffice).

## Core posture (inherits the iron rules)

**Answers are drafts, not writes.** A submitted intake NEVER mutates the
client record by itself. Staff review each proposed field change and apply
explicitly (mirrors AI drafts-only and the M9 import review step). The two
sanctioned automatic side effects, both already-audited existing machinery:
document uploads flow through the M3/M5 pipeline, and answer-driven
checklist items are created/satisfied exactly like a staff edit would,
auto-advance included (ADR-0017).

## Model

**Question types (v1):** `yes_no`, `choice` (single-select, ≤6 options),
`text` (short), `date`, `money` (integer cents, ADR-0030 rules), `upload`
(deep-links into the existing portal capture/upload flow).

**Branching:** each question may carry `visible_if: {question_key, equals}` —
one flat condition, no boolean algebra, no chaining depth beyond one level
(a hidden question's dependents are hidden too). Covers "Did you sell a
property?" → follow-ups without building a rules engine.

**Checklist mapping:** a question may declare `checklist_on_yes:
{title, required}` (for `yes_no`) — answering yes creates that item on the
linked engagement's checklist (missing); an `upload` question may declare
`satisfies_checklist_title` — the upload files against the matching item.
Category-keyed nothing: intake talks to checklists by title, staying out of
the stage machinery (only the existing upload/auto-advance path touches
stages).

**Field-update proposals:** a question may declare `maps_to_field` (one of
`email`, `phone`, `address_line1`, `city`, `province`, `postal_code`,
`date_of_birth`, `preferred_channel`). These answers surface in review as
current-vs-proposed diffs with per-field Apply buttons. Applied changes go
through the normal client-update action (`clients.manage`, audited).

## Schema (new migration + FORCEd RLS)

- `intake_template`: `id`, `org_id`, `name` (unique per org),
  `engagement_type` (nullable — suggested template per return type),
  `questions jsonb` (versioned shape `{v: 1, questions: [...]}`, validated
  by zod on every write), `archived_at`, timestamps. Seeded default: a
  ~12-question T1 organizer per org (bootstrap + seed, like message
  templates).
- `intake_request`: `id`, `org_id`, `client_id`, `engagement_id` (nullable),
  `template_snapshot jsonb` (frozen at send — template edits never mutate
  in-flight intakes; same snapshot philosophy as invoice lines, ADR-0030),
  `answers jsonb` (`{[question_key]: {value, answered_at}}`), `status` enum
  `draft|sent|in_progress|submitted|reviewed|canceled`, `portal_token_id`
  FK, `sent_at`, `submitted_at`, `reviewed_by/at`, timestamps.
- Applied-field audit lives in the existing `audit_log` (no new table).

## Flows

**Author (staff):** Settings → Intake templates (list/edit/archive, variable
question editor with live portal-style preview). Client detail + engagement
panel get "Send intake" → pick template → issues/reuses a portal link whose
scopes include the new `intake` scope, notifies via the M5 outbox (new
default template `intake_request` with `{intake_link}`), request → `sent`.

**Answer (portal, AAA):** portal home gains an "Answer a few questions" card
(pending intakes for the token's client scope). One question per screen:
big-type prompt, plain-language help text, Back/Next, progress dots. Every
answer saves server-side immediately (`in_progress` on first answer) — an
interrupted client resumes where they left off even after the 30-min session
lapses and the link is re-opened. `upload` questions jump into the existing
capture flow and return to the questionnaire. Final screen: review-my-answers
list → "Send to your accountant" → `submitted`, staff notified via the
existing dashboard surfaces (below), contact-log entry, audited as actor
client.

**Review (staff):** intake detail page: answers grouped by section, the
field-proposal diff block (Apply per field), checklist effects already
applied and labeled, "Mark reviewed" → `reviewed`. Returns/dashboard: the
front-desk and firm dashboards each gain a "Submitted intakes" count wired
like the M10 cards; the engagement panel shows intake status inline.

**Reminders (v1.5, flagged not blocking):** extend the M5 reminders-sweep
with an `intake_outstanding` policy (same cadence/consent machinery,
category-agnostic). Ship v1 with manual re-send from the request row.

## Sensitive data

- The template zod schema REJECTS questions whose key/label/`maps_to_field`
  reference SIN — there is no encrypted-answer path in v1, so the product
  simply never asks (import wizard remains the only SIN ingress, ADR-0033).
- `date_of_birth` is an ordinary plain column on `client` already; allowed
  as a `date` question via `maps_to_field`, applied only through review.
- Answer free text is client-authored; anything AI-facing later must pass
  `scrubFreeText` like notes do (M8 rule). No AI touches intakes in v1.
- Answers render only in staff surfaces gated by `clients.view` scoping
  (assigned-only accountants see only their book's intakes — reuse
  `viewAssignedOnlyFilter`).

## Permissions

- `intake.manage_templates`: owner/admin allow, accountant/clerk deny
  (mirrors `messages.manage_templates`).
- `intake.send`: owner/admin/clerk allow, accountant assigned — front desk
  sends intakes exactly like portal links (ADR-0019/0023 posture).
- `intake.review` (view + apply-field + mark-reviewed): owner/admin allow,
  accountant assigned, clerk view-only via a split `intake.view` if the
  matrix needs it — decide at build; default: clerk may VIEW submissions
  (front desk answers "did my stuff go through?" calls) but Apply-field
  requires `clients.manage`.
- Portal side is scope-gated (`intake`), like `sign` (ADR-0026).

## Decisions to record at build time (ADR series)

1. Template snapshot frozen on send (in-flight immutability).
2. Drafts-not-writes review posture + the two sanctioned side effects.
3. Flat one-level `visible_if` branching (no rules engine).
4. No-SIN-questions rule.
5. Intake scope rides the existing portal token (no new token table —
   same reasoning as ADR-0026).

## Tests / acceptance

- Vitest: template zod validation (rejects SIN questions, bad branching
  refs, >1-level chains), branching visibility resolver, answer-save
  idempotency/resume, checklist_on_yes + satisfies mapping, field-proposal
  apply goes through clients.manage + audit, snapshot immutability after
  template edit, RLS isolation + red-team rows for both tables, matrix rows.
- Playwright ACCEPTANCE: send T1 organizer → portal answers with a branch
  (property yes → follow-ups appear), an upload question files against the
  checklist item, submit → staff review shows the diff → Apply updates the
  phone → engagement checklist gained the yes-item; axe AAA green on every
  new portal screen (M4 bar).
- Manual (Satinder): real-phone pass of the questionnaire + capture handoff.

## Phase 2 (explicitly deferred)

AI question-draft ("draft an organizer for a T2 client"), AI submission
summary (both narrate-only, M8 pattern), signing the completed organizer,
household intakes, per-question conditional checklists beyond yes/no,
automated intake reminders if not shipped in v1.5.
