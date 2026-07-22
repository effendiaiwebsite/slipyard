import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireStaff } from "@/lib/context";
import { can } from "@/lib/permissions";
import { StagesManager } from "./stages-manager";

export const metadata = { title: "Workflow stages" };

export default async function StagesSettingsPage() {
  const ctx = await requireStaff();
  if (!can(ctx.actor, "org.update_settings")) redirect("/app/settings");

  const [stages, engagements] = await Promise.all([
    ctx.scope.listStages(),
    ctx.scope.listEngagementsWithMeta(),
  ]);
  const countsByStage = new Map<string, number>();
  for (const e of engagements) {
    countsByStage.set(e.stage.id, (countsByStage.get(e.stage.id) ?? 0) + 1);
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <div className="text-xs text-slate-500 mb-0.5">
          <Link href="/app/settings" className="hover:underline">
            Settings
          </Link>{" "}
          · Workflow stages
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Workflow stages</h1>
        <p className="text-sm text-slate-600 mt-1">
          These are the columns on your workflow board. Rename, reorder, add or remove them to
          match how your office actually works.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Stages</CardTitle>
          <CardDescription>
            Every stage has a <em>meaning</em> (the second column) that reminders, checklists and
            signatures hook onto — renaming a stage never breaks those.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StagesManager
            stages={stages.map((s) => ({
              id: s.id,
              label: s.label,
              category: s.category,
              count: countsByStage.get(s.id) ?? 0,
            }))}
            disabled={ctx.readOnly}
          />
        </CardContent>
      </Card>
    </div>
  );
}
