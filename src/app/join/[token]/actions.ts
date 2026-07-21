"use server";

import { OrgScope, acceptInvitation, findInvitationByTokenHash } from "@/db/scoped";
import { syncSeatQuantity } from "@/lib/billing";
import { requireSession } from "@/lib/context";
import { hashInviteToken, invitationProblem } from "@/lib/invites";
import { logger } from "@/lib/logger";
import { redirect } from "next/navigation";

/**
 * Accept an invitation. Requires a signed-in session whose email matches the
 * invite. Org identity comes from the invite row located by token hash —
 * never from the client.
 */
export async function acceptInviteAction(rawToken: string): Promise<{ error: string } | never> {
  const session = await requireSession();
  const tokenHash = hashInviteToken(rawToken);
  const found = await findInvitationByTokenHash(tokenHash);
  const problem = invitationProblem(found?.invitation);
  if (!found || problem) return { error: problem ?? "Invalid invitation" };

  const inv = found.invitation;
  if (session.user.email.toLowerCase() !== inv.email.toLowerCase()) {
    return {
      error: `This invitation is for ${inv.email}, but you're signed in as ${session.user.email}.`,
    };
  }

  await acceptInvitation(inv.id, inv.orgId, tokenHash, session.user.id, inv.role, inv.invitedBy);

  // Seats follow active memberships; failure here self-corrects on the next
  // membership change.
  try {
    const scope = new OrgScope(inv.orgId, session.user.id);
    const org = await scope.getOrg();
    await syncSeatQuantity(scope, org?.stripeSubscriptionId ?? null);
  } catch (e) {
    logger.error({ err: e, orgId: inv.orgId }, "seat sync after invite accept failed");
  }

  // requireStaff enforces MFA before any staff surface renders.
  redirect("/setup-mfa");
}
