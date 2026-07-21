"use server";

import { acceptInvitation, findInvitationByTokenHash } from "@/db/scoped";
import { requireSession } from "@/lib/context";
import { hashInviteToken, invitationProblem } from "@/lib/invites";
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

  // requireStaff enforces MFA before any staff surface renders.
  redirect("/setup-mfa");
}
