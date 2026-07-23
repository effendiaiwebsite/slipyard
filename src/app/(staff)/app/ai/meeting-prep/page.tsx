import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { viewAssignedOnlyFilter } from "@/lib/clients";
import { requireStaff } from "@/lib/context";
import { AiDisabledCard } from "../ai-disabled-card";
import { MeetingPrepTool } from "./meeting-prep-tool";

export const metadata = { title: "Meeting prep" };

/**
 * Meeting prep (M8): a one-page brief before sitting down with a client —
 * where their returns stand, what's outstanding, recent conversations, and
 * suggested talking points. Read-only, drafts only.
 */
export default async function MeetingPrepPage() {
  const ctx = await requireStaff();
  const assignedOnly = viewAssignedOnlyFilter(ctx);
  const clients = ctx.orgSettings.ai_enabled
    ? await ctx.scope.listClientsWithMeta({
        status: "active",
        ...(assignedOnly ? { assignedToId: assignedOnly } : {}),
      })
    : [];

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Meeting prep</h1>
        <p className="text-sm text-slate-500 mt-1">
          A quick brief before a client sits down: returns, outstanding items, recent contact,
          and talking points.
        </p>
      </div>

      {ctx.orgSettings.ai_enabled ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Prepare a client brief</CardTitle>
          </CardHeader>
          <CardContent>
            <MeetingPrepTool
              clients={clients.map((c) => ({ id: c.client.id, name: c.client.displayName }))}
            />
          </CardContent>
        </Card>
      ) : (
        <AiDisabledCard />
      )}
    </div>
  );
}
