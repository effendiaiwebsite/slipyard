import Link from "next/link";
import { requireStaff } from "@/lib/context";
import { can } from "@/lib/permissions";
import { RETENTION_YEARS, retainedYears, retentionHorizon } from "@/lib/retention";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Retention review" };

const SOURCE_LABEL: Record<string, string> = {
  staff_upload: "Staff upload",
  portal_upload: "Portal upload",
  esign_executed: "Signed PDF",
};

/**
 * Retention review (M9, ADR-0034): read-only surface of documents past the
 * 7-year hold. Nothing is deleted here — disposal is a deliberate, audited
 * admin act. In a young deployment this list is empty; the card explains the
 * posture.
 */
export default async function RetentionPage() {
  const ctx = await requireStaff();
  if (!can(ctx.actor, "documents.view")) {
    return (
      <div className="p-6 max-w-2xl">
        <h1 className="text-xl font-semibold tracking-tight">Retention review</h1>
        <p className="text-sm text-slate-500 mt-1">You don&apos;t have access to this section.</p>
      </div>
    );
  }

  const now = new Date();
  const horizon = retentionHorizon(now);
  const [counts, due] = await Promise.all([
    ctx.scope.countRetentionDocuments(horizon),
    ctx.scope.listRetentionReviewDocuments(horizon),
  ]);

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Retention review</h1>
        <p className="text-sm text-slate-500 mt-1">
          Client documents are kept for {RETENTION_YEARS} years and never deleted automatically.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardDescription>Documents kept</CardDescription>
            <CardTitle className="text-2xl">{counts.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Past {RETENTION_YEARS}-year horizon</CardDescription>
            <CardTitle className="text-2xl">{counts.due}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Review cutoff</CardDescription>
            <CardTitle className="text-lg">{horizon.toLocaleDateString("en-CA")}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">How retention works here</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-600 space-y-2">
          <p>
            Vault documents and executed e-signature PDFs have <strong>no delete path</strong> by
            design — they can&apos;t be removed in the normal course of work, so a 7-year record is
            guaranteed. This page lists anything created on or before{" "}
            {horizon.toLocaleDateString("en-CA")} so an owner or admin can review it. Disposing of a
            document after the hold is a deliberate, audited step — never automatic.
          </p>
          <p className="text-xs text-slate-500">
            Backups (<code>scripts/backup.ts</code>) protect the record independently; deleting a
            whole firm cascades its rows and its S3 objects are swept separately.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Due for review</CardTitle>
          <CardDescription>
            Documents held longer than {RETENTION_YEARS} years.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {due.length === 0 ? (
            <p className="text-sm text-slate-400">
              Nothing has passed the {RETENTION_YEARS}-year horizon yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                    <th className="py-2 pr-3 font-medium">Document</th>
                    <th className="py-2 pr-3 font-medium">Client</th>
                    <th className="py-2 pr-3 font-medium">Source</th>
                    <th className="py-2 pr-3 font-medium">Held</th>
                    <th className="py-2 pr-3 font-medium">Since</th>
                  </tr>
                </thead>
                <tbody>
                  {due.map((d) => (
                    <tr key={d.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-3 text-slate-700 truncate max-w-56" title={d.filename}>
                        {d.filename}
                      </td>
                      <td className="py-2 pr-3">
                        <Link href={`/app/clients/${d.clientId}`} className="text-indigo-600 hover:underline">
                          {d.clientName}
                        </Link>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge>{SOURCE_LABEL[d.source] ?? d.source}</Badge>
                      </td>
                      <td className="py-2 pr-3 text-slate-600">{retainedYears(d.createdAt, now)} yr</td>
                      <td className="py-2 pr-3 text-slate-600">{d.createdAt.toLocaleDateString("en-CA")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
