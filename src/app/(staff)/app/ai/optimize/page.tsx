import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { computeOptimizationFindings, loadInsightInputs } from "@/lib/ai/insights";
import { aiContextFromStaff } from "@/lib/ai/service";
import { viewAssignedOnlyFilter } from "@/lib/clients";
import { requireStaff } from "@/lib/context";
import { AiDisabledCard } from "../ai-disabled-card";
import { FindingsTable } from "../findings-view";
import { NarrativePanel } from "../narrative-panel";

export const metadata = { title: "Optimization advisor" };

/**
 * Optimization advisor (M8, ADR-0032): deterministic practice-operations
 * opportunities — aged WIP, outstanding invoices, missing-season clients,
 * unreachable clients, reminder policy gaps. The AI only narrates the rules.
 */
export default async function OptimizePage() {
  const ctx = await requireStaff();
  const findings = ctx.orgSettings.ai_enabled
    ? computeOptimizationFindings(
        await loadInsightInputs(aiContextFromStaff(ctx), viewAssignedOnlyFilter(ctx))
      )
    : [];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Optimization advisor</h1>
        <p className="text-sm text-slate-500 mt-1">
          Where the practice is leaving time or money on the table: unbilled work, aging
          invoices, clients without a current-season return, and reachability gaps.
        </p>
      </div>

      {ctx.orgSettings.ai_enabled ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">
                Opportunities ({findings.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <FindingsTable findings={findings} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">AI summary</CardTitle>
            </CardHeader>
            <CardContent>
              <NarrativePanel feature="optimize" />
            </CardContent>
          </Card>
        </>
      ) : (
        <AiDisabledCard />
      )}
    </div>
  );
}
