import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { computeAuditRiskFindings, loadInsightInputs } from "@/lib/ai/insights";
import { aiContextFromStaff } from "@/lib/ai/service";
import { viewAssignedOnlyFilter } from "@/lib/clients";
import { requireStaff } from "@/lib/context";
import { AiDisabledCard } from "../ai-disabled-card";
import { FindingsTable } from "../findings-view";
import { NarrativePanel } from "../narrative-panel";

export const metadata = { title: "Audit risk" };

/**
 * Audit risk (M8, ADR-0032): deterministic PRACTICE-risk rules over what the
 * CRM actually holds (this product has no return amounts — it sits beside the
 * EFILE software). The table is the rule output; the AI only narrates it.
 */
export default async function AuditRiskPage() {
  const ctx = await requireStaff();
  const findings = ctx.orgSettings.ai_enabled
    ? computeAuditRiskFindings(
        await loadInsightInputs(aiContextFromStaff(ctx), viewAssignedOnlyFilter(ctx))
      )
    : [];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Audit risk</h1>
        <p className="text-sm text-slate-500 mt-1">
          Practice-risk flags from deterministic rules: filings with missing paperwork, work
          without CRA authority, quarantined uploads, stale returns. Advisory only — nothing is
          changed or stored.
        </p>
      </div>

      {ctx.orgSettings.ai_enabled ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">
                Findings ({findings.length})
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
              <NarrativePanel feature="audit_risk" />
            </CardContent>
          </Card>
        </>
      ) : (
        <AiDisabledCard />
      )}
    </div>
  );
}
