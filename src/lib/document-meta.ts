/**
 * Client-safe display metadata for documents & checklists (M3) — no server
 * imports so client components can use it freely.
 */

export const DOC_STATUS_META: Record<
  "pending_scan" | "clean" | "infected" | "scan_failed",
  { label: string; badge: "default" | "accent" | "success" | "warn" | "danger" | "ai" }
> = {
  pending_scan: { label: "Scanning…", badge: "default" },
  clean: { label: "In vault", badge: "success" },
  infected: { label: "Virus detected", badge: "danger" },
  scan_failed: { label: "Scan failed", badge: "warn" },
};

export const CHECKLIST_STATUS_META: Record<
  "missing" | "received" | "waived",
  { label: string; badge: "default" | "accent" | "success" | "warn" | "danger" | "ai" }
> = {
  missing: { label: "Missing", badge: "warn" },
  received: { label: "Received", badge: "success" },
  waived: { label: "Waived", badge: "default" },
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
