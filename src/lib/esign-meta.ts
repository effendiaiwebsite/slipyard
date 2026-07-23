/**
 * Client-safe display metadata for signature requests (M6) — no server
 * imports so client components can use it freely.
 */

export type SignatureStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "signed"
  | "declined"
  | "canceled";

export const SIGNATURE_STATUS_META: Record<
  SignatureStatus,
  { label: string; badge: "default" | "accent" | "success" | "warn" | "danger" | "ai" }
> = {
  draft: { label: "Draft", badge: "default" },
  sent: { label: "Out for signature", badge: "accent" },
  viewed: { label: "Viewed", badge: "accent" },
  signed: { label: "Signed", badge: "success" },
  declined: { label: "Declined", badge: "danger" },
  canceled: { label: "Cancelled", badge: "default" },
};

/** A request is still open (counts toward "out for signature"). */
export function isOpenSignatureStatus(status: SignatureStatus): boolean {
  return status === "draft" || status === "sent" || status === "viewed";
}
