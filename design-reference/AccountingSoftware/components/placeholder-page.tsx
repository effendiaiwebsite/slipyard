import { Card, CardBody } from "@/components/ui/card";
import { Construction, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

export function PlaceholderPage({
  title,
  kicker,
  description,
  bullets,
  hero,
}: {
  title: string;
  kicker?: string;
  description: string;
  bullets: string[];
  hero?: { href: string; label: string };
}) {
  return (
    <div className="p-8 max-w-5xl">
      {kicker && <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">{kicker}</div>}
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-slate-600 max-w-2xl">{description}</p>

      <Card className="mt-6">
        <CardBody>
          <div className="flex items-center gap-2 mb-4">
            <Construction className="w-4 h-4 text-amber-600" />
            <Badge tone="warn">Mock — skeleton only</Badge>
            <span className="text-sm text-slate-500">This screen is stubbed for the prototype tour.</span>
          </div>
          <div className="text-sm font-medium mb-2">What this screen would show:</div>
          <ul className="space-y-1.5 text-sm text-slate-700">
            {bullets.map((b, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-slate-300">›</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
          {hero && (
            <div className="mt-6 p-4 rounded-lg bg-violet-50 ring-1 ring-violet-200 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-violet-900">See the full version</div>
                <div className="text-xs text-violet-700">{hero.label}</div>
              </div>
              <Link href={hero.href} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-violet-600 text-white text-sm font-medium hover:bg-violet-500">
                Open <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
