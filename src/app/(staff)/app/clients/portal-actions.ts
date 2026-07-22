"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/context";
import { sendEmail } from "@/lib/messaging";
import { authorize, PermissionError, ReadOnlyOrgError } from "@/lib/permissions";
import { mintPortalLink } from "@/lib/portal-tokens";
import { sendSms } from "@/lib/messaging";

/**
 * Portal link issuance/revocation (M4). requireStaff → zod → authorize
 * (portal.manage_links, audited) → mint/revoke. The raw link goes ONLY into
 * outbox messages (console in dev) — it is never returned to the browser,
 * stored, or logged (ADR-0003).
 */

type ActionResult = { error?: string; ok?: boolean } | null;

const issueSchema = z.object({
  clientId: z.string().uuid(),
  recipient: z.enum(["client", "helper"]),
  recipientName: z.string().trim().min(2).max(120).optional(),
  helperRelationship: z.string().trim().max(80).optional(),
  recipientPhone: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/, "Phone must be in +1… format (E.164)"),
  includeHousehold: z.boolean(),
});

export async function issuePortalLink(
  clientId: string,
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ctx = await requireStaff();
  const parsed = issueSchema.safeParse({
    clientId,
    recipient: formData.get("recipient"),
    recipientName: (formData.get("recipientName") as string) || undefined,
    helperRelationship: (formData.get("helperRelationship") as string) || undefined,
    recipientPhone: formData.get("recipientPhone"),
    includeHousehold: formData.get("includeHousehold") === "on",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const input = parsed.data;

  const client = await ctx.scope.getClient(input.clientId);
  if (!client) return { error: "Client not found" };
  if (client.status !== "active") {
    return { error: "Archived clients can't receive portal links." };
  }
  const isHelper = input.recipient === "helper";
  if (isHelper && !input.recipientName) {
    return { error: "Enter the helper's name." };
  }

  try {
    await authorize(
      ctx.scope,
      ctx.actor,
      "portal.manage_links",
      { orgId: client.orgId, type: "client", id: client.id, assignedTo: client.assignedAccountantId },
      {
        readOnlyOrg: ctx.readOnly,
        orgSettings: ctx.orgSettings,
        details: { op: "issue", isHelper, includeHousehold: input.includeHousehold },
      }
    );
  } catch (e) {
    if (e instanceof PermissionError || e instanceof ReadOnlyOrgError) return { error: e.message };
    throw e;
  }

  const recipientName = isHelper ? input.recipientName! : client.displayName;
  const { url } = await mintPortalLink(ctx.scope, {
    clientId: client.id,
    recipientName,
    recipientPhone: input.recipientPhone,
    isHelper,
    helperRelationship: isHelper ? (input.helperRelationship ?? null) : null,
    includeHousehold: input.includeHousehold,
    createdBy: ctx.user.id,
  });

  const firmName = ctx.orgName;
  await sendSms(ctx.scope, {
    to: input.recipientPhone,
    body: `${firmName}: your secure portal link for ${client.displayName}'s documents: ${url} — the link works for 7 days and is personal to you. We'll text a security code when you open it.`,
    meta: { kind: "portal_link", clientId: client.id },
  });
  // Belt and braces for clients who read email more reliably than texts.
  if (!isHelper && client.email) {
    await sendEmail(ctx.scope, {
      to: client.email,
      subject: `${firmName} — your secure document portal`,
      body: `Hello ${client.displayName},\n\n${firmName} set up a secure page where you can send us your tax documents and see what we still need:\n\n${url}\n\nThe link works for 7 days. When you open it, we'll text a 6-digit security code to your phone ending in ${input.recipientPhone.slice(-4)}.\n\nIf you weren't expecting this, please call the office.`,
      meta: { kind: "portal_link", clientId: client.id },
    });
  }

  revalidatePath(`/app/clients/${client.id}`);
  return { ok: true };
}

export async function revokePortalLink(tokenId: string): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!z.string().uuid().safeParse(tokenId).success) return { error: "Invalid link" };

  const token = await ctx.scope.getPortalToken(tokenId);
  if (!token) return { error: "Link not found" };
  const client = await ctx.scope.getClient(token.clientId);

  try {
    await authorize(
      ctx.scope,
      ctx.actor,
      "portal.manage_links",
      {
        orgId: token.orgId,
        type: "portal_token",
        id: token.id,
        assignedTo: client?.assignedAccountantId,
      },
      {
        readOnlyOrg: ctx.readOnly,
        orgSettings: ctx.orgSettings,
        details: { op: "revoke", clientId: token.clientId },
      }
    );
  } catch (e) {
    if (e instanceof PermissionError || e instanceof ReadOnlyOrgError) return { error: e.message };
    throw e;
  }

  await ctx.scope.updatePortalToken(token.id, { revokedAt: new Date() });
  revalidatePath(`/app/clients/${token.clientId}`);
  return { ok: true };
}
