import Link from "next/link";
import { requireStaff } from "@/lib/context";
import { can } from "@/lib/permissions";
import { CLIENT_TARGET_FIELDS, SAMPLE_IMPORT_CSV } from "@/lib/imports";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ImportWizard } from "./import-wizard";

export const metadata = { title: "Data import" };

const STATUS_META: Record<string, { label: string; variant: "success" | "warn" | "danger" | "default" }> = {
  staged: { label: "Staged", variant: "default" },
  committed: { label: "Imported", variant: "success" },
  rolled_back: { label: "Rolled back", variant: "warn" },
  partially_rolled_back: { label: "Partly rolled back", variant: "warn" },
};

export default async function ImportPage() {
  const ctx = await requireStaff();

  if (!can(ctx.actor, "import.manage")) {
    return (
      <div className="p-6 max-w-2xl space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">Data import</h1>
        <p className="text-sm text-slate-500">
          The import wizard is available to firm owners and administrators. Ask an owner or admin to
          run a bulk import.
        </p>
        <Link href="/app/settings" className="text-sm text-indigo-600 hover:underline">
          ← Back to settings
        </Link>
      </div>
    );
  }

  const [templates, batches] = await Promise.all([
    ctx.scope.listImportMappingTemplates(),
    ctx.scope.listImportBatches(10),
  ]);

  const targetFields = CLIENT_TARGET_FIELDS.map((f) => ({
    key: f.key,
    label: f.label,
    group: f.group,
    required: f.required,
    hint: f.hint,
  }));

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Data import</h1>
          <p className="text-sm text-slate-500 mt-1">
            Bulk-load clients from a CSV — map messy columns onto client fields and custom fields,
            review, then undo if needed.
          </p>
        </div>
        <Link
          href="/app/documents/bulk"
          className="text-sm text-indigo-600 hover:underline whitespace-nowrap"
        >
          Bulk document upload →
        </Link>
      </div>

      <Card>
        <CardContent className="pt-6">
          <ImportWizard
            targetFields={targetFields}
            templates={templates.map((t) => ({ id: t.id, name: t.name, mapping: t.mapping }))}
            sampleCsv={SAMPLE_IMPORT_CSV}
          />
        </CardContent>
      </Card>

      {batches.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Recent imports</CardTitle>
            <CardDescription>The last {batches.length} import batches for this firm.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                    <th className="py-2 pr-3 font-medium">When</th>
                    <th className="py-2 pr-3 font-medium">File</th>
                    <th className="py-2 pr-3 font-medium">Rows</th>
                    <th className="py-2 pr-3 font-medium">Imported</th>
                    <th className="py-2 pr-3 font-medium">By</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map(({ batch, createdByName }) => {
                    const meta = STATUS_META[batch.status] ?? STATUS_META.staged;
                    return (
                      <tr key={batch.id} className="border-b border-slate-100 last:border-0">
                        <td className="py-2 pr-3 text-slate-600">
                          {batch.createdAt.toLocaleDateString("en-CA")}
                        </td>
                        <td className="py-2 pr-3 text-slate-700">{batch.filename}</td>
                        <td className="py-2 pr-3 text-slate-600">{batch.rowCount}</td>
                        <td className="py-2 pr-3 text-slate-600">{batch.createdCount}</td>
                        <td className="py-2 pr-3 text-slate-600">{createdByName ?? "—"}</td>
                        <td className="py-2 pr-3">
                          <Badge variant={meta.variant}>{meta.label}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
