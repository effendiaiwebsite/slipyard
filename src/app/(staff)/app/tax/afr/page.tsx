import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { viewAssignedOnlyFilter } from "@/lib/clients";
import { requireStaff } from "@/lib/context";
import { AfrTool } from "./afr-tool";

export const metadata = { title: "AFR reconciliation" };

/**
 * AFR reconciliation (M7): paste the CRA slip list the firm's tax software
 * downloaded (Auto-fill My Return) and compare it against what's on file for
 * the client's engagement. The CRM sits BESIDE the EFILE software — the CSV
 * paste is the bridge (ADR-0029).
 */
export default async function AfrPage() {
  const ctx = await requireStaff();
  const assignedOnly = viewAssignedOnlyFilter(ctx);
  const clients = await ctx.scope.listClientsWithMeta({
    status: "active",
    ...(assignedOnly ? { assignedToId: assignedOnly } : {}),
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">AFR reconciliation</h1>
        <p className="text-sm text-slate-500 mt-1">
          Paste the CRA slip CSV from your tax software&apos;s Auto-fill download and compare it
          against the client&apos;s checklist and documents.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Compare CRA slips to what&apos;s on file</CardTitle>
        </CardHeader>
        <CardContent>
          <AfrTool
            clients={clients.map((c) => ({ id: c.client.id, name: c.client.displayName }))}
            defaultYear={new Date().getFullYear() - 1}
          />
        </CardContent>
      </Card>
    </div>
  );
}
