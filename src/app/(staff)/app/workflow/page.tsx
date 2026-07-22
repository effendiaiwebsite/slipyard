import Link from "next/link";
import { ENGAGEMENT_TYPE_LABELS, viewAssignedOnlyFilter } from "@/lib/clients";
import { requireStaff } from "@/lib/context";
import { can } from "@/lib/permissions";
import { Board, type BoardCard, type BoardStage } from "./board";

export const metadata = { title: "Workflow board" };

export default async function WorkflowPage({
  searchParams,
}: {
  searchParams: Promise<{ owner?: string }>;
}) {
  const { owner } = await searchParams;
  const ctx = await requireStaff();

  // assigned_only accountants are always narrowed; everyone else can toggle
  // between the whole firm and their own cards.
  const forced = viewAssignedOnlyFilter(ctx);
  const mineOnly = forced !== undefined || owner === "me";
  const [stageRows, rows] = await Promise.all([
    ctx.scope.listStages(),
    ctx.scope.listEngagementsWithMeta({
      assignedToId: forced ?? (mineOnly ? ctx.user.id : undefined),
    }),
  ]);

  const stages: BoardStage[] = stageRows.map((s) => ({
    id: s.id,
    key: s.key,
    label: s.label,
    category: s.category,
  }));

  const cards: BoardCard[] = rows.map((r) => ({
    id: r.engagement.id,
    clientId: r.engagement.clientId,
    clientName: r.clientName,
    label: `${ENGAGEMENT_TYPE_LABELS[r.engagement.type]} ${r.engagement.taxYear}`,
    stageId: r.engagement.stageId,
    assignedName: r.assignedName,
    since: r.engagement.statusTimestamps[r.stage.key] ?? null,
    canTransition:
      !ctx.readOnly &&
      can(ctx.actor, "engagements.transition", {
        orgId: r.engagement.orgId,
        type: "engagement",
        id: r.engagement.id,
        assignedTo: r.engagement.assignedToId,
      }),
  }));

  const draggable = cards.filter((c) => c.canTransition).length;

  return (
    <div className="p-6 h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
        <div>
          <div className="text-xs text-slate-500 mb-0.5">Practice · Workflow</div>
          <h1 className="text-xl font-semibold tracking-tight">Workflow board</h1>
          <p className="text-sm text-slate-600 mt-1">
            {cards.length} engagement(s)
            {draggable < cards.length && " · cards you can't transition are locked"}
          </p>
        </div>
        {forced === undefined && (
          <div className="flex items-center gap-1">
            <FilterLink href="/app/workflow" active={!mineOnly}>
              Whole firm
            </FilterLink>
            <FilterLink href="/app/workflow?owner=me" active={mineOnly}>
              Mine
            </FilterLink>
          </div>
        )}
      </div>
      <Board stages={stages} cards={cards} />
    </div>
  );
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`px-2.5 py-1 rounded-md text-xs font-medium ${
        active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      {children}
    </Link>
  );
}
