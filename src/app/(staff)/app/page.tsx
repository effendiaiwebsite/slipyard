import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CATEGORY_META } from "@/lib/clients";
import { DOC_STATUS_META } from "@/lib/document-meta";
import { requireStaff, type StaffContext } from "@/lib/context";

/**
 * Dashboard — three variants (M10):
 *  owner/admin  — firm-wide counts.
 *  accountant   — personal counts (assigned clients/engagements only).
 *  clerk        — front-desk board: intake queue, firm-wide documents
 *                 outstanding, recent portal uploads. Clerks see all clients
 *                 (ADR-0023) but nothing is ever assigned to them, so the
 *                 personal variant read as zeros — customer-noted, 2026-07-22.
 */
export default async function DashboardPage() {
  const ctx = await requireStaff();
  if (ctx.role === "clerk") return <FrontDeskDashboard ctx={ctx} />;

  const firmWide = ctx.role === "owner" || ctx.role === "admin";

  // Personal variant counts only what's assigned to the viewer.
  const mineOnly = firmWide ? undefined : ctx.user.id;
  const [stages, byStage, clients, members, openSignatures, uncoveredClients, missingDocs] =
    await Promise.all([
      ctx.scope.listStages(),
      ctx.scope.countEngagementsByStage(mineOnly),
      ctx.scope.listClientsWithMeta(mineOnly ? { assignedToId: mineOnly } : undefined),
      firmWide ? ctx.scope.listMemberships() : Promise.resolve(null),
      ctx.scope.countOpenSignatureRequests(mineOnly),
      ctx.scope.countClientsWithoutActiveAuthorization(mineOnly),
      ctx.scope.countMissingRequiredDocuments(mineOnly),
    ]);

  // Category totals survive any stage customization (ADR-0015).
  const byCategory = new Map<string, number>();
  let total = 0;
  for (const s of stages) {
    const n = byStage.get(s.id) ?? 0;
    total += n;
    byCategory.set(s.category, (byCategory.get(s.category) ?? 0) + n);
  }
  const open =
    total - (byCategory.get("filed") ?? 0) - (byCategory.get("complete") ?? 0);
  const activeClients = clients.filter((c) => c.client.status === "active").length;

  const stats = [
    {
      label: firmWide ? "Active clients" : "My assigned clients",
      value: activeClients,
      href: "/app/clients",
    },
    { label: firmWide ? "Open engagements" : "My open engagements", value: open, href: "/app/workflow" },
    {
      label: "Awaiting documents",
      value: byCategory.get("awaiting_docs") ?? 0,
      href: "/app/workflow",
    },
    {
      label: "Awaiting signature",
      value: byCategory.get("awaiting_signature") ?? 0,
      href: "/app/workflow",
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Welcome back, {ctx.user.name.split(" ")[0]}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {firmWide
            ? `${ctx.orgName} — firm dashboard.`
            : "Your personal dashboard — your assigned clients and work."}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card className="hover:ring-2 hover:ring-indigo-200 transition h-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-500 font-medium">{s.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tabular-nums">{s.value}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            {firmWide ? "Engagements by stage" : "My engagements by stage"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {total === 0 ? (
            <p className="text-sm text-slate-400">
              No engagements yet — add one from a{" "}
              <Link href="/app/clients" className="underline underline-offset-2">
                client page
              </Link>
              .
            </p>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              {stages.map((s) => (
                <Link
                  key={s.id}
                  href="/app/workflow"
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md ring-1 ring-slate-200 hover:bg-slate-50 text-sm"
                >
                  <Badge variant={CATEGORY_META[s.category].badge}>{s.label}</Badge>
                  <span className="font-semibold tabular-nums">{byStage.get(s.id) ?? 0}</span>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Link href="/app/esign">
          <Card className="hover:ring-2 hover:ring-indigo-200 transition h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500 font-medium">
                {firmWide ? "Out for signature" : "My out for signature"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">{openSignatures}</div>
              <Badge className="mt-2" variant="accent">
                E-signatures
              </Badge>
            </CardContent>
          </Card>
        </Link>
        <Link href="/app/tax/authorizations">
          <Card className="hover:ring-2 hover:ring-indigo-200 transition h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500 font-medium">
                Authorization coverage
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">{uncoveredClients}</div>
              <Badge className="mt-2" variant={uncoveredClients > 0 ? "warn" : "success"}>
                {uncoveredClients === 1
                  ? "client without CRA access"
                  : "clients without CRA access"}
              </Badge>
            </CardContent>
          </Card>
        </Link>
        <DocumentsOutstandingCard items={missingDocs.items} engagements={missingDocs.engagements} />
      </div>

      {firmWide && members && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Team</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-600">
            {members.filter((m) => m.membership.status === "active").length} active member(s).
            Manage roles and invitations in{" "}
            <a href="/app/settings/employees" className="underline underline-offset-2">
              Settings → Employees
            </a>
            .
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Real missing-required-docs count (was the "Arrives in M3" placeholder). */
function DocumentsOutstandingCard({
  items,
  engagements,
}: {
  items: number;
  engagements: number;
}) {
  return (
    <Link href="/app/tax">
      <Card className="hover:ring-2 hover:ring-indigo-200 transition h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-slate-500 font-medium">
            Documents outstanding
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold tabular-nums">{items}</div>
          <Badge className="mt-2" variant={items > 0 ? "warn" : "success"}>
            {items === 0
              ? "all required documents in"
              : engagements === 1
                ? "required, across 1 return"
                : `required, across ${engagements} returns`}
          </Badge>
        </CardContent>
      </Card>
    </Link>
  );
}

/** Front-desk (clerk) dashboard — the desk's actual workflow, firm-wide. */
async function FrontDeskDashboard({ ctx }: { ctx: StaffContext }) {
  const [stages, byStage, clients, intake, missingDocs, portalUploads] = await Promise.all([
    ctx.scope.listStages(),
    ctx.scope.countEngagementsByStage(),
    ctx.scope.listClientsWithMeta(),
    ctx.scope.listIntakeDocuments(),
    ctx.scope.countMissingRequiredDocuments(),
    ctx.scope.listRecentPortalUploads(8),
  ]);

  const awaitingDocs = stages
    .filter((s) => s.category === "awaiting_docs")
    .reduce((n, s) => n + (byStage.get(s.id) ?? 0), 0);
  const activeClients = clients.filter((c) => c.client.status === "active").length;
  const pendingIntake = intake.filter((d) => d.document.status !== "clean").length;

  const stats = [
    { label: "Documents in intake", value: intake.length, href: "/app/tax/intake" },
    { label: "Awaiting documents", value: awaitingDocs, href: "/app/tax" },
    { label: "Active clients", value: activeClients, href: "/app/clients" },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Welcome back, {ctx.user.name.split(" ")[0]}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {ctx.orgName} — front desk. Intake, portal links and reminders live here.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card className="hover:ring-2 hover:ring-indigo-200 transition h-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-500 font-medium">{s.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tabular-nums">{s.value}</div>
                {s.label === "Documents in intake" && pendingIntake > 0 && (
                  <Badge className="mt-2" variant="warn">
                    {pendingIntake} not yet cleared
                  </Badge>
                )}
              </CardContent>
            </Card>
          </Link>
        ))}
        <DocumentsOutstandingCard items={missingDocs.items} engagements={missingDocs.engagements} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Intake queue</CardTitle>
          </CardHeader>
          <CardContent>
            {intake.length === 0 ? (
              <p className="text-sm text-slate-400">
                Nothing waiting — uploads from the{" "}
                <Link href="/app/tax/intake" className="underline underline-offset-2">
                  intake queue
                </Link>{" "}
                land here.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {intake.slice(0, 6).map(({ document: d, clientName }) => (
                  <li key={d.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{d.filename}</p>
                      <p className="text-slate-500 truncate">{clientName}</p>
                    </div>
                    <Badge variant={DOC_STATUS_META[d.status].badge}>
                      {DOC_STATUS_META[d.status].label}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            {intake.length > 6 && (
              <p className="text-sm mt-2">
                <Link href="/app/tax/intake" className="underline underline-offset-2">
                  All {intake.length} in the intake queue →
                </Link>
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Recent portal uploads</CardTitle>
          </CardHeader>
          <CardContent>
            {portalUploads.length === 0 ? (
              <p className="text-sm text-slate-400">
                No portal uploads yet. Issue portal links from a client page.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {portalUploads.map(({ document: d, clientName }) => (
                  <li key={d.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{d.filename}</p>
                      <p className="text-slate-500 truncate">
                        {clientName} · {new Date(d.createdAt).toLocaleDateString("en-CA")}
                      </p>
                    </div>
                    <Badge variant={DOC_STATUS_META[d.status].badge}>
                      {DOC_STATUS_META[d.status].label}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Quick actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 text-sm">
          <Link
            href="/app/tax/intake"
            className="px-3 py-1.5 rounded-md ring-1 ring-slate-200 hover:bg-slate-50"
          >
            Upload to intake
          </Link>
          <Link
            href="/app/clients"
            className="px-3 py-1.5 rounded-md ring-1 ring-slate-200 hover:bg-slate-50"
          >
            Issue a portal link
          </Link>
          <Link
            href="/app/messaging"
            className="px-3 py-1.5 rounded-md ring-1 ring-slate-200 hover:bg-slate-50"
          >
            Send reminders
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
