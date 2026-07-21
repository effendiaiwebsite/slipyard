import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function PlaceholderPage({
  title,
  description,
  milestone,
}: {
  title: string;
  description: string;
  milestone: string;
}) {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-slate-500 mt-1">{description}</p>
      </div>
      <Card>
        <CardContent className="p-8 flex flex-col items-center justify-center text-center gap-3">
          <Badge variant="accent">Planned — {milestone}</Badge>
          <p className="text-sm text-slate-500 max-w-md">
            This area is scaffolded and will be built in {milestone}. See docs/MILESTONES.md for
            the build order.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
