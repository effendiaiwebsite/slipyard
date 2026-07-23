import Link from "next/link";
import { viewAssignedOnlyFilter } from "@/lib/clients";
import { requireStaff } from "@/lib/context";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BulkUploader } from "./bulk-uploader";

export const metadata = { title: "Bulk document upload" };

/**
 * Bulk document importer (M9, ADR-0034): drop many files against one client;
 * each routes through the same /api/vault/upload quarantine → ClamAV → vault
 * pipeline as a single upload, landing in the intake queue. Same permission as
 * intake (documents.intake_upload — clerks included); filing to a return
 * happens afterward on the intake queue / client page.
 */
export default async function BulkUploadPage() {
  const ctx = await requireStaff();
  const canUpload = !ctx.readOnly && can(ctx.actor, "documents.intake_upload");

  if (!canUpload) {
    return (
      <div className="p-6 max-w-2xl space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">Bulk document upload</h1>
        <p className="text-sm text-slate-500">
          {ctx.readOnly
            ? "Uploads are paused while the subscription is inactive."
            : "You don't have permission to upload documents."}
        </p>
      </div>
    );
  }

  const assignedOnly = viewAssignedOnlyFilter(ctx);
  const clients = await ctx.scope.listClientsWithMeta({ status: "active", assignedToId: assignedOnly });

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Bulk document upload</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Add many files for one client at once — each is virus-scanned and lands in the intake
            queue to file against a return.
          </p>
        </div>
        <Link href="/app/tax/intake" className="text-sm text-indigo-600 hover:underline whitespace-nowrap">
          Go to intake queue →
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Choose a client, then add files</CardTitle>
          <CardDescription>PDF, images, Office files, CSV/text · up to 25 MB each.</CardDescription>
        </CardHeader>
        <CardContent>
          <BulkUploader clients={clients.map((c) => ({ id: c.client.id, name: c.client.displayName }))} />
        </CardContent>
      </Card>
    </div>
  );
}
