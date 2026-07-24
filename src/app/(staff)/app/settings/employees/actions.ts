"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/context";
import { env } from "@/lib/env";
import { hashInviteToken } from "@/lib/invites";
import { logger } from "@/lib/logger";
import { sendEmail, sendSms } from "@/lib/messaging";
import { authorize } from "@/lib/permissions";
import { resetStaffTwoFactor } from "@/lib/staff-recovery";
import { phonePreprocess } from "@/lib/phone";

const inviteSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  // Any common format is accepted and normalised to E.164 (lib/phone.ts).
  phone: z.preprocess(
    phonePreprocess,
    z
      .string()
      .trim()
      .regex(/^\+1\d{10}$/, "That doesn't look like a Canadian mobile number — 10 digits, any format.")
      .optional()
      .or(z.literal(""))
  ),
  role: z.enum(["admin", "accountant", "clerk"]), // owner is never invited — ownership transfers are a settings op for later
});

type ActionResult = { error?: string; ok?: boolean };

export async function inviteEmployee(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requireStaff();
  const parsed = inviteSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone") || "",
    role: formData.get("role"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { name, email, phone, role } = parsed.data;

  await authorize(ctx.scope, ctx.actor, "employees.invite", { orgId: ctx.orgId, type: "invitation" }, {
    readOnlyOrg: ctx.readOnly,
    details: { role },
  });

  // No duplicate active members/invites for the same address.
  const members = await ctx.scope.listMemberships();
  if (members.some((m) => m.user.email.toLowerCase() === email && m.membership.status === "active")) {
    return { error: "That email already belongs to an active member of this firm." };
  }
  const invites = await ctx.scope.listInvitations();
  if (invites.some((i) => i.email.toLowerCase() === email && !i.acceptedAt && i.expiresAt > new Date())) {
    return { error: "There is already a pending invitation for that email. Revoke it first to re-send." };
  }

  const rawToken = randomBytes(32).toString("base64url");
  const invitation = await ctx.scope.createInvitation({
    email,
    phone: phone || null,
    name,
    role,
    tokenHash: hashInviteToken(rawToken),
    invitedBy: ctx.user.id,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  const link = `${env.APP_URL}/join/${rawToken}`;
  await sendEmail(ctx.scope, {
    to: email,
    subject: `${ctx.orgName} invited you to their practice CRM`,
    body: [
      `Hi ${name},`,
      ``,
      `${ctx.user.name} invited you to join ${ctx.orgName} as ${role}.`,
      `Accept your invitation (link expires in 7 days):`,
      link,
      ``,
      `If you weren't expecting this, you can ignore this message.`,
    ].join("\n"),
    meta: { invitationId: invitation.id, kind: "invite" },
  });
  if (phone) {
    await sendSms(ctx.scope, {
      to: phone,
      body: `${ctx.orgName}: ${ctx.user.name} invited you to their practice CRM. Join (7 days): ${link}`,
      meta: { invitationId: invitation.id, kind: "invite" },
    });
  }

  logger.info({ invitationId: invitation.id, orgId: ctx.orgId }, "invitation sent");
  revalidatePath("/app/settings/employees");
  return { ok: true };
}

export async function revokeInvitation(invitationId: string): Promise<ActionResult> {
  const ctx = await requireStaff();
  await authorize(
    ctx.scope,
    ctx.actor,
    "employees.manage",
    { orgId: ctx.orgId, type: "invitation", id: invitationId },
    { readOnlyOrg: ctx.readOnly, details: { op: "revoke_invitation" } }
  );
  await ctx.scope.revokeInvitation(invitationId);
  revalidatePath("/app/settings/employees");
  return { ok: true };
}

const roleChangeSchema = z.object({
  membershipId: z.string().uuid(),
  role: z.enum(["owner", "admin", "accountant", "clerk"]),
});

export async function changeMemberRole(membershipId: string, role: string): Promise<ActionResult> {
  const ctx = await requireStaff();
  const parsed = roleChangeSchema.safeParse({ membershipId, role });
  if (!parsed.success) return { error: "Invalid input" };

  await authorize(
    ctx.scope,
    ctx.actor,
    "employees.manage",
    { orgId: ctx.orgId, type: "org_membership", id: membershipId },
    { readOnlyOrg: ctx.readOnly, details: { op: "change_role", role: parsed.data.role } }
  );

  const target = await ctx.scope.getMembershipById(parsed.data.membershipId);
  if (!target) return { error: "Member not found" };
  // Only an owner may grant or remove the owner role.
  if ((target.role === "owner" || parsed.data.role === "owner") && ctx.role !== "owner") {
    return { error: "Only an owner can change owner roles." };
  }
  // Never drop the last active owner.
  if (target.role === "owner" && parsed.data.role !== "owner") {
    if ((await ctx.scope.countActiveOwners()) <= 1) {
      return { error: "A firm must keep at least one owner." };
    }
  }
  await ctx.scope.updateMembership(parsed.data.membershipId, { role: parsed.data.role });
  revalidatePath("/app/settings/employees");
  return { ok: true };
}

/**
 * Clear a member's TOTP enrollment + revoke their sessions so they can
 * re-enroll (lost/replaced authenticator). Pair with "Forgot password?" for
 * the full self-lockout recovery path.
 */
export async function resetMemberMfa(membershipId: string): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!z.string().uuid().safeParse(membershipId).success) return { error: "Invalid input" };

  await authorize(
    ctx.scope,
    ctx.actor,
    "employees.manage",
    { orgId: ctx.orgId, type: "org_membership", id: membershipId },
    { readOnlyOrg: ctx.readOnly, details: { op: "reset_mfa" } }
  );

  const target = await ctx.scope.getMembershipById(membershipId);
  if (!target) return { error: "Member not found" };
  if (target.userId === ctx.user.id) {
    return { error: "You can't reset your own two-factor while signed in — ask another admin." };
  }
  if (target.role === "owner" && ctx.role !== "owner") {
    return { error: "Only an owner can reset an owner's two-factor." };
  }

  await resetStaffTwoFactor(target.userId);
  logger.info({ membershipId, orgId: ctx.orgId }, "member two-factor reset");
  revalidatePath("/app/settings/employees");
  return { ok: true };
}

export async function setMemberStatus(
  membershipId: string,
  status: "active" | "deactivated"
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!z.string().uuid().safeParse(membershipId).success) return { error: "Invalid input" };

  await authorize(
    ctx.scope,
    ctx.actor,
    "employees.manage",
    { orgId: ctx.orgId, type: "org_membership", id: membershipId },
    { readOnlyOrg: ctx.readOnly, details: { op: "set_status", status } }
  );

  const target = await ctx.scope.getMembershipById(membershipId);
  if (!target) return { error: "Member not found" };
  if (target.userId === ctx.user.id) return { error: "You can't deactivate your own account." };
  if (target.role === "owner" && status === "deactivated" && (await ctx.scope.countActiveOwners()) <= 1) {
    return { error: "A firm must keep at least one active owner." };
  }

  await ctx.scope.updateMembership(membershipId, { status });
  revalidatePath("/app/settings/employees");
  return { ok: true };
}
