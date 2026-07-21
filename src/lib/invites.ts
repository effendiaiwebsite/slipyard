import { createHash } from "node:crypto";
import type { invitation } from "@/db/schema";

/** sha256 of the raw invite token — only the hash is ever stored (ADR-0003). */
export function hashInviteToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

type Invitation = typeof invitation.$inferSelect;

export function invitationProblem(inv: Invitation | null | undefined): string | null {
  if (!inv) return "This invitation link isn't valid.";
  if (inv.revokedAt) return "This invitation was revoked. Ask your firm to send a new one.";
  if (inv.acceptedAt) return "This invitation was already used.";
  if (inv.expiresAt.getTime() < Date.now())
    return "This invitation has expired (links last 7 days). Ask your firm to send a new one.";
  return null;
}
