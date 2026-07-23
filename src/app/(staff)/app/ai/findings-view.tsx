import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { InsightFinding } from "@/lib/ai/insights";

/** Deterministic rule output, rendered as-is (ADR-0032) — the table IS the truth; the AI narrative beside it is just phrasing. */
export function FindingsTable({ findings }: { findings: InsightFinding[] }) {
  if (findings.length === 0) {
    return (
      <p className="text-sm text-slate-500" data-testid="findings-empty">
        Nothing needs attention — all rules came back clean.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 border-b border-[var(--color-border)]">
            <th className="py-2 pr-3 font-medium">Severity</th>
            <th className="py-2 pr-3 font-medium">Client</th>
            <th className="py-2 pr-3 font-medium">Finding</th>
            <th className="py-2 pr-3 font-medium">Rule</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((f, i) => (
            <tr
              key={i}
              data-testid={`finding-${f.rule}`}
              className="border-b border-[var(--color-border)] last:border-0"
            >
              <td className="py-2 pr-3">
                <Badge
                  variant={f.severity === "high" ? "danger" : f.severity === "medium" ? "warn" : "default"}
                >
                  {f.severity}
                </Badge>
              </td>
              <td className="py-2 pr-3">
                {f.clientId ? (
                  <Link
                    href={`/app/clients/${f.clientId}`}
                    className="text-indigo-700 hover:underline underline-offset-2"
                  >
                    {f.client}
                  </Link>
                ) : (
                  <span className="text-slate-500">{f.client ?? "Firm-wide"}</span>
                )}
              </td>
              <td className="py-2 pr-3 text-slate-700">{f.summary}</td>
              <td className="py-2 pr-3 font-mono text-xs text-slate-400">{f.rule}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
