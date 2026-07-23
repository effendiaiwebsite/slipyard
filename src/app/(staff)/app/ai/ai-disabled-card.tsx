import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

/** Shown on every /app/ai page when the org's AI toggle is off. */
export function AiDisabledCard() {
  return (
    <Card>
      <CardContent className="p-8 flex flex-col items-center justify-center text-center gap-3">
        <Badge>AI is turned off</Badge>
        <p className="text-sm text-slate-500 max-w-md">
          An owner or admin can re-enable AI features in Settings → Firm profile. Nothing else in
          the app is affected.
        </p>
      </CardContent>
    </Card>
  );
}
