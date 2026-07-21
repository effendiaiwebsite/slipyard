import { OrgScope } from "@/db/scoped";
import type { OrgSettings } from "@/db/schema";

/**
 * THE permission matrix — the single place roles and actions are defined
 * (§1). Every mutation handler routes through authorize(), which checks
 * can() and writes audit_log; there is no other sanctioned path.
 *
 * Roles:
 *  owner      — everything incl. billing, employee management, org settings.
 *  admin      — everything except billing and org deletion.
 *  accountant — full read/write on clients assigned to them; read-only on the
 *               rest of the firm (org setting accountant_scope_mode can
 *               restrict to assigned-only; see ADR-0004).
 *  clerk      — read-only on ALL clients; may add documents to the intake
 *               queue and send templated reminders; no edits, no exports of
 *               SIN-bearing data.
 */

export type Role = "owner" | "admin" | "accountant" | "clerk";

export const ACTIONS = [
  // org & billing
  "org.view",
  "org.update_settings",
  "org.delete",
  "billing.manage",
  // employees
  "employees.view",
  "employees.invite",
  "employees.manage",
  // clients (resource-aware for accountants)
  "clients.view",
  "clients.create",
  "clients.update",
  "clients.export_sensitive",
  // engagements
  "engagements.view",
  "engagements.transition",
  // documents
  "documents.view",
  "documents.intake_upload",
  "documents.manage",
  // messaging
  "messages.send_templated",
  "messages.manage_templates",
  "messages.send_custom",
  // audit
  "audit.view",
] as const;

export type Action = (typeof ACTIONS)[number];

/** allow | deny | assigned — 'assigned' passes only when the resource is
 *  assigned to the acting user (accountant write scope). */
type Rule = "allow" | "deny" | "assigned";

const MATRIX: Record<Role, Record<Action, Rule>> = {
  owner: {
    "org.view": "allow",
    "org.update_settings": "allow",
    "org.delete": "allow",
    "billing.manage": "allow",
    "employees.view": "allow",
    "employees.invite": "allow",
    "employees.manage": "allow",
    "clients.view": "allow",
    "clients.create": "allow",
    "clients.update": "allow",
    "clients.export_sensitive": "allow",
    "engagements.view": "allow",
    "engagements.transition": "allow",
    "documents.view": "allow",
    "documents.intake_upload": "allow",
    "documents.manage": "allow",
    "messages.send_templated": "allow",
    "messages.manage_templates": "allow",
    "messages.send_custom": "allow",
    "audit.view": "allow",
  },
  admin: {
    "org.view": "allow",
    "org.update_settings": "allow",
    "org.delete": "deny",
    "billing.manage": "deny",
    "employees.view": "allow",
    "employees.invite": "allow",
    "employees.manage": "allow",
    "clients.view": "allow",
    "clients.create": "allow",
    "clients.update": "allow",
    "clients.export_sensitive": "allow",
    "engagements.view": "allow",
    "engagements.transition": "allow",
    "documents.view": "allow",
    "documents.intake_upload": "allow",
    "documents.manage": "allow",
    "messages.send_templated": "allow",
    "messages.manage_templates": "allow",
    "messages.send_custom": "allow",
    "audit.view": "allow",
  },
  accountant: {
    "org.view": "allow",
    "org.update_settings": "deny",
    "org.delete": "deny",
    "billing.manage": "deny",
    "employees.view": "allow",
    "employees.invite": "deny",
    "employees.manage": "deny",
    "clients.view": "allow", // narrowed to 'assigned' when accountant_scope_mode = assigned_only
    "clients.create": "allow",
    "clients.update": "assigned",
    "clients.export_sensitive": "assigned",
    "engagements.view": "allow",
    "engagements.transition": "assigned",
    "documents.view": "allow",
    "documents.intake_upload": "allow",
    "documents.manage": "assigned",
    "messages.send_templated": "allow",
    "messages.manage_templates": "deny",
    "messages.send_custom": "assigned",
    "audit.view": "deny",
  },
  clerk: {
    "org.view": "allow",
    "org.update_settings": "deny",
    "org.delete": "deny",
    "billing.manage": "deny",
    "employees.view": "allow",
    "employees.invite": "deny",
    "employees.manage": "deny",
    "clients.view": "allow",
    "clients.create": "deny",
    "clients.update": "deny",
    "clients.export_sensitive": "deny",
    "engagements.view": "allow",
    "engagements.transition": "deny",
    "documents.view": "allow",
    "documents.intake_upload": "allow",
    "documents.manage": "deny",
    "messages.send_templated": "allow",
    "messages.manage_templates": "deny",
    "messages.send_custom": "deny",
    "audit.view": "deny",
  },
};

export type Actor = {
  userId: string;
  orgId: string;
  role: Role;
};

export type ResourceRef = {
  /** The org the resource belongs to — MUST be present; cross-org is a hard error. */
  orgId: string;
  type: string;
  id?: string;
  /** Staff user id the resource (client/engagement) is assigned to, if any. */
  assignedTo?: string | null;
};

export class PermissionError extends Error {
  constructor(action: Action, role: Role) {
    super(`Role '${role}' is not permitted to '${action}'`);
    this.name = "PermissionError";
  }
}

export class TenancyViolationError extends Error {
  constructor() {
    // Deliberately vague message; details go to the audit log, not the caller.
    super("Resource is out of scope");
    this.name = "TenancyViolationError";
  }
}

export function can(
  actor: Actor,
  action: Action,
  resource?: ResourceRef,
  orgSettings?: OrgSettings
): boolean {
  if (resource && resource.orgId !== actor.orgId) {
    // Never a soft deny: a cross-org reference reaching the permission layer
    // means an upstream bug or an attack. Fail loudly.
    throw new TenancyViolationError();
  }
  let rule = MATRIX[actor.role][action];
  if (
    action === "clients.view" &&
    actor.role === "accountant" &&
    orgSettings?.accountant_scope_mode === "assigned_only"
  ) {
    rule = "assigned";
  }
  if (rule === "allow") return true;
  if (rule === "deny") return false;
  // 'assigned': needs a resource with an assignee matching the actor.
  return !!resource && resource.assignedTo === actor.userId;
}

/**
 * Check + audit in one step. Writes audit_log for every permitted
 * client-data action AND for every denial (action 'denied:<action>').
 */
export async function authorize(
  scope: OrgScope,
  actor: Actor,
  action: Action,
  resource: ResourceRef | undefined,
  opts?: { ip?: string; details?: Record<string, unknown>; orgSettings?: OrgSettings }
): Promise<void> {
  let allowed = false;
  try {
    allowed = can(actor, action, resource, opts?.orgSettings);
  } catch (e) {
    if (e instanceof TenancyViolationError) {
      await scope.writeAudit({
        actorType: "staff",
        action: `tenancy_violation:${action}`,
        resourceType: resource?.type ?? "unknown",
        resourceId: resource?.id,
        details: { attemptedOrgId: resource?.orgId, ...opts?.details },
        ip: opts?.ip,
      });
    }
    throw e;
  }
  if (!allowed) {
    await scope.writeAudit({
      actorType: "staff",
      action: `denied:${action}`,
      resourceType: resource?.type ?? "org",
      resourceId: resource?.id,
      details: opts?.details,
      ip: opts?.ip,
    });
    throw new PermissionError(action, actor.role);
  }
  await scope.writeAudit({
    actorType: "staff",
    action,
    resourceType: resource?.type ?? "org",
    resourceId: resource?.id,
    details: opts?.details,
    ip: opts?.ip,
  });
}
