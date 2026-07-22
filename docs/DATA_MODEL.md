# Data model (authoritative)

Conventions: UUID PKs (`gen_random_uuid()` or better-auth generateId →
randomUUID), `timestamptz` timestamps, `org_id` on every tenant table,
snake_case in SQL / camelCase in Drizzle. Schema source:
`src/db/schema/*.ts`; RLS in `drizzle/0001_m0_rls.sql`.

## Auth tables (better-auth managed — NOT org-scoped)

Why not org-scoped: a staff user may belong to several orgs, and login/session
resolution happens before an org context exists. Model names are mapped in
`src/lib/auth.ts` (`user` → staff_user etc.).

### staff_user
| field | type | notes |
|---|---|---|
| id | text PK | UUID string |
| name, email (unique), image | text | |
| email_verified | bool | seed sets true; real verification M1 |
| two_factor_enabled | bool | gate checked by requireStaff — mandatory MFA |
| created_at, updated_at | timestamptz | |

### auth_session
token (unique), user_id FK, expires_at (12 h absolute), ip_address,
user_agent, created_at, updated_at. `updated_at` doubles as last-activity for
the 30-min idle check (better-auth updateAge = 5 min).

### auth_account
Credential + OAuth accounts per user. `provider_id` 'credential' rows carry
the scrypt password hash; 'google' rows carry OAuth tokens.

### auth_verification
better-auth's generic verification store (email tokens, OAuth state).

### auth_two_factor
secret, backup_codes, user_id FK, verified, failed_verification_count,
locked_until — the last three power better-auth's TOTP brute-force lockout.

## Tenant tables (RLS FORCEd)

### org
| field | type | notes |
|---|---|---|
| id | uuid PK | |
| name | text | |
| timezone | text | IANA; default America/Toronto; used for signing stamps |
| subscription_status | enum subscription_status | trialing/active/past_due/canceled — driven by Stripe webhooks (M1); past_due/canceled ⇒ read-only grace mode |
| stripe_customer_id | text | set at first Checkout (M1) |
| settings | jsonb OrgSettings | `ai_enabled` (default true), `accountant_scope_mode` ('all_read' default — ADR-0004) |
| created_at, updated_at | timestamptz | |

RLS: `id = app.org_id` OR user has active membership (login-time org list).

### org_membership
org_id FK, user_id FK, role (enum staff_role: owner/admin/accountant/clerk),
status (enum membership_status: active/deactivated), invited_by FK,
timestamps. Unique (org_id, user_id). Deactivation keeps the row (history,
seat count) — status flips.
RLS: tenant match OR `user_id = app.user_id` (pre-org lookup).

### invitation
email, phone, name, role, token_hash (sha256 — raw token only ever exists in
the sent link), invited_by FK, expires_at (7 days), accepted_at, revoked_at.
Why hash: a DB leak must not yield live invite links.

### audit_log (append-only)
| field | type | notes |
|---|---|---|
| org_id | uuid FK (restrict) | |
| actor_type | enum actor_type | staff/client/system/ai |
| actor_user_id | text FK nullable | null for system/client/ai actors |
| action | text | e.g. `clients.update`, `denied:clients.update`, `tenancy_violation:*` |
| resource_type, resource_id | text | |
| details | jsonb | NEVER SIN/tokens/URLs |
| ip | text | |
| created_at | timestamptz | |

Append-only enforced in DB: crm_app has SELECT+INSERT only. Written by
`authorize()` on every permitted client-data action, every denial, and every
tenancy violation.

### org — M1 additions
`stripe_subscription_id` (set at first Checkout; cleared on deletion),
`trial_ends_at` (app-level 14-day trial from org creation; Stripe's own trial
takes over after Checkout). Extra RLS policies: `org_by_stripe_customer`
(webhook path, GUC app.stripe_customer_id) — see ADR-0009.

### outbox (M1, RLS)
Every outbound email/SMS: channel (enum outbox_channel email/sms),
to_address, subject (email only), body, status (enum outbox_status
queued/sent/failed), provider ('console' in dev; ses/smtp/twilio from M5),
provider_message_id, error, meta jsonb, sent_at. Bodies carry invite/magic
links — sensitive; never logged.

### stripe_event (M1, NOT under RLS)
Webhook idempotency: Stripe event id PK + type + processed_at. No tenant
data; touched only by the webhook route. First-insert-wins gates processing.

## Client hub (M2, all RLS FORCEd — drizzle/0007_m2_rls.sql)

### client
| field | type | notes |
|---|---|---|
| type | enum client_type | individual/corporation/trust |
| status | enum client_status | active/archived — archive, never delete |
| display_name | text | |
| email, phone | text | phone E.164 |
| preferred_channel | enum preferred_channel | email/sms/phone/mail (elderly clientele ⇒ default phone) |
| address_line1, city, province, postal_code | text | province 2-letter |
| date_of_birth | date | never sent to model APIs |
| sin_encrypted | text | AES-256-GCM via src/lib/crypto encryptField; NEVER plaintext |
| sin_last3 | text | what maskSin shows — lists render the mask without decrypting |
| assigned_accountant_id | text FK staff_user | drives accountant write scope |
| household_id | uuid FK household | set null on household delete |
| tags | text[] | free-form chips |
| custom_fields | jsonb Record<string,string> | ad-hoc per-firm fields (import wizard M9 maps here) |
| created_by | text FK staff_user | |

### household
org_id, name, created_at. Family grouping for display + (M4) trusted-helper
scoping. Members = clients with household_id.

### engagement_stage (ADR-0015)
Per-org workflow pipeline — firms rename/add/remove/reorder their stages.
| field | type | notes |
|---|---|---|
| key | text | immutable slug, unique per org; renames change label only |
| label | text | what the firm calls it (board column header) |
| category | enum stage_category | FIXED semantic anchor — automations hook here, never labels |
| position | int | board order |

New orgs get the 7-stage default template (DEFAULT_ENGAGEMENT_STAGES) at
bootstrap. Min 2 stages; deleting an in-use stage reassigns its engagements
first (FK below is RESTRICT as backstop).

### engagement
client_id FK, type (enum engagement_type t1/t2/t3/other), tax_year int,
stage_id FK engagement_stage (RESTRICT — see above),
status_timestamps jsonb (stage KEY → ISO instant it was last entered),
assigned_to_id FK staff_user (defaults to the client's accountant at
creation), created_by. Transitions are any→any (ADR-0013), permission-checked
(`engagements.transition`, accountants only on assigned), audited.

### client_note
client_id FK, author_id, body, pinned bool. Pinned notes surface in the
detail-page callout.

### contact_log
client_id FK, channel (enum contact_channel phone/email/sms/meeting/mail/
other), summary, occurred_at, created_by. max(occurred_at) is "last contact"
in the grid.

## Vault & checklists (M3, RLS FORCEd — drizzle/0012_m3_rls.sql)

### document
| field | type | notes |
|---|---|---|
| client_id | uuid FK client (cascade) | documents always belong to a client |
| engagement_id | uuid FK engagement nullable (set null) | null = intake queue; set when filed against a return |
| filename | text | sanitized original name (display + S3 key tail) |
| content_type, size_bytes | text, bigint | allowlisted types, 25 MB cap (src/lib/storage.ts) |
| s3_key | text | CURRENT location: org/{orgId}/quarantine/{id}/… until clean, then org/{orgId}/vault/{id}/… |
| status | enum document_status | pending_scan → clean / infected / scan_failed (retryable) |
| scan_result | text | virus signature (infected) or error summary (scan_failed); null when clean |
| scanned_at | timestamptz | |
| source | enum document_source | staff_upload; portal_upload arrives with M4 |
| uploaded_by | text FK staff_user nullable | null for portal uploads later |

Lifecycle (ADR-0016): upload route → quarantine + pending_scan → ClamAV →
clean (promoted to vault) / infected (stays quarantined, never
downloadable) / scan_failed (retry via documents.manage). Downloads are
5-min presigned GETs, clean docs only, audited as documents.view.

### checklist_item
| field | type | notes |
|---|---|---|
| engagement_id | uuid FK engagement (cascade) | |
| title | text | from CHECKLIST_TEMPLATES (per engagement type) or custom |
| required | bool | only required items gate auto-advance |
| status | enum checklist_item_status | missing / received / waived |
| document_id | uuid FK document nullable (set null) | the doc that satisfied it; null for manual receipt |
| position | int | template order; custom items append |

State changes trigger applyAutoAdvance (ADR-0017): category-keyed, forward
only, never past awaiting_docs→in_progress boundaries.

## Enums
subscription_status: trialing, active, past_due, canceled
staff_role: owner, admin, accountant, clerk
membership_status: active, deactivated
actor_type: staff, client, system, ai
outbox_channel: email, sms
outbox_status: queued, sent, failed
client_type: individual, corporation, trust
client_status: active, archived
preferred_channel: email, sms, phone, mail
engagement_type: t1, t2, t3, other
stage_category: not_started, awaiting_docs, in_progress, awaiting_signature, filed, complete
contact_channel: phone, email, sms, meeting, mail, other
document_status: pending_scan, clean, infected, scan_failed
document_source: staff_upload, portal_upload
checklist_item_status: missing, received, waived

## Planned (added at their milestone; spec §3)
trusted_helper, signature_request, cra_authorization, message, portal_token,
time_entry, invoice, ai_interaction, import_batch, import_mapping_template,
staging tables.
