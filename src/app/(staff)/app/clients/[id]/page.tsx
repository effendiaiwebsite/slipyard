import { Pencil, Pin } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CATEGORY_META, CHANNEL_LABELS, ENGAGEMENT_TYPE_LABELS, TYPE_LABELS } from "@/lib/clients";
import { requireStaff } from "@/lib/context";
import { authorize, can, PermissionError } from "@/lib/permissions";
import {
  AddContactForm,
  AddNoteForm,
  ArchiveButton,
  AssignSelect,
  NewEngagementForm,
  PinToggle,
  TransitionSelect,
} from "./detail-forms";

export const metadata = { title: "Client" };

const fmt = (d: Date) => d.toLocaleDateString("en-CA");

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireStaff();

  const detail = await ctx.scope.getClientDetail(id);
  if (!detail) notFound();
  const c = detail.client;

  // Client-data read: audited, and (assigned_only orgs) scoped — an
  // accountant opening someone else's client gets a 404, not a hint.
  try {
    await authorize(
      ctx.scope,
      ctx.actor,
      "clients.view",
      { orgId: c.orgId, type: "client", id: c.id, assignedTo: c.assignedAccountantId },
      { orgSettings: ctx.orgSettings }
    );
  } catch (e) {
    if (e instanceof PermissionError) notFound();
    throw e;
  }

  const clientResource = {
    orgId: c.orgId,
    type: "client",
    id: c.id,
    assignedTo: c.assignedAccountantId,
  };
  const canEdit =
    !ctx.readOnly && can(ctx.actor, "clients.update", clientResource, ctx.orgSettings);
  const canCreateEng = !ctx.readOnly && can(ctx.actor, "engagements.create", clientResource);

  const [memberships, stageRows] = await Promise.all([
    ctx.scope.listMemberships(),
    ctx.scope.listStages(),
  ]);
  const members = memberships
    .filter((m) => m.membership.status === "active" && m.membership.role !== "clerk")
    .map((m) => ({ id: m.user.id, name: m.user.name }));
  const stageOptions = stageRows.map((s) => ({ id: s.id, name: s.label }));

  const pinnedNotes = detail.notes.filter((n) => n.note.pinned);
  const currentYear = new Date().getFullYear();

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs text-slate-500 mb-0.5">
            <Link href="/app/clients" className="hover:underline">
              Clients
            </Link>{" "}
            · {c.displayName}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-semibold tracking-tight">{c.displayName}</h1>
            <Badge variant="accent">{TYPE_LABELS[c.type]}</Badge>
            {c.status === "archived" && <Badge>Archived</Badge>}
            {c.tags.map((t) => (
              <span key={t} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px]">
                {t}
              </span>
            ))}
          </div>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/app/clients/${c.id}/edit`}>
                <Pencil /> Edit
              </Link>
            </Button>
            <ArchiveButton clientId={c.id} status={c.status} />
          </div>
        )}
      </div>

      {pinnedNotes.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-1">
          {pinnedNotes.map((n) => (
            <div key={n.note.id} className="flex items-start gap-2 text-sm text-amber-900">
              <Pin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{n.note.body}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Engagements</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {detail.engagements.length === 0 && (
                <p className="text-sm text-slate-400">No engagements yet.</p>
              )}
              {detail.engagements.map(({ engagement: e, assignedName, stage }) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between gap-3 flex-wrap border-b border-[var(--color-border)] last:border-0 pb-3 last:pb-0"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-slate-600">
                      {ENGAGEMENT_TYPE_LABELS[e.type]} {e.taxYear}
                    </span>
                    <Badge variant={CATEGORY_META[stage.category].badge}>{stage.label}</Badge>
                    {e.statusTimestamps[stage.key] && (
                      <span className="text-xs text-slate-400">
                        since {fmt(new Date(e.statusTimestamps[stage.key]))}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {!ctx.readOnly &&
                    can(ctx.actor, "engagements.transition", {
                      orgId: e.orgId,
                      type: "engagement",
                      id: e.id,
                      assignedTo: e.assignedToId,
                    }) ? (
                      <TransitionSelect engagementId={e.id} stageId={e.stageId} stages={stageOptions} />
                    ) : (
                      <span className="text-xs text-slate-500">{assignedName ?? "Unassigned"}</span>
                    )}
                    {canEdit && (
                      <AssignSelect engagementId={e.id} members={members} current={e.assignedToId} />
                    )}
                  </div>
                </div>
              ))}
              {canCreateEng && (
                <NewEngagementForm clientId={c.id} members={members} defaultYear={currentYear - 1} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Contact log</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {canEdit && <AddContactForm clientId={c.id} />}
              {detail.contacts.length === 0 && (
                <p className="text-sm text-slate-400">No contact recorded yet.</p>
              )}
              <ul className="space-y-2">
                {detail.contacts.map(({ entry, byName }) => (
                  <li key={entry.id} className="text-sm flex items-start gap-3">
                    <span className="text-xs text-slate-400 font-mono w-20 shrink-0 pt-0.5">
                      {fmt(entry.occurredAt)}
                    </span>
                    <Badge className="shrink-0">{CHANNEL_LABELS[entry.channel]}</Badge>
                    <span className="text-slate-700">
                      {entry.summary}
                      {byName && <span className="text-slate-400"> — {byName}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {canEdit && <AddNoteForm clientId={c.id} />}
              {detail.notes.length === 0 && <p className="text-sm text-slate-400">No notes yet.</p>}
              <ul className="space-y-3">
                {detail.notes.map(({ note, authorName }) => (
                  <li key={note.id} className="text-sm border-b border-[var(--color-border)] last:border-0 pb-3 last:pb-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-slate-700 whitespace-pre-wrap">{note.body}</p>
                      {canEdit && <PinToggle clientId={c.id} noteId={note.id} pinned={note.pinned} />}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      {authorName ?? "Unknown"} · {fmt(note.createdAt)}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Identity & contact</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2.5 text-sm">
                <Row label="Preferred">{CHANNEL_LABELS[c.preferredChannel]}</Row>
                <Row label="Email">{c.email ?? "—"}</Row>
                <Row label="Phone">{c.phone ?? "—"}</Row>
                <Row label="Address">
                  {[c.addressLine1, c.city, c.province, c.postalCode].filter(Boolean).join(", ") || "—"}
                </Row>
                {c.type === "individual" && (
                  <>
                    <Row label="Date of birth">{c.dateOfBirth ?? "—"}</Row>
                    <Row label="SIN">
                      {c.sinLast3 ? (
                        <span className="font-mono">*** *** {c.sinLast3}</span>
                      ) : (
                        <span className="text-slate-400">Not on file</span>
                      )}
                    </Row>
                  </>
                )}
                <Row label="Assigned to">{detail.assignedName ?? "Unassigned"}</Row>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Household</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {detail.householdName ? (
                <>
                  <div className="font-medium mb-2">{detail.householdName}</div>
                  {detail.householdMembers.length > 0 ? (
                    <ul className="space-y-1">
                      {detail.householdMembers.map((m) => (
                        <li key={m.id}>
                          <Link
                            href={`/app/clients/${m.id}`}
                            className="text-indigo-700 hover:underline underline-offset-2"
                          >
                            {m.displayName}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-slate-400">No other members.</p>
                  )}
                </>
              ) : (
                <p className="text-slate-400">Not part of a household.</p>
              )}
            </CardContent>
          </Card>

          {Object.keys(c.customFields).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Custom fields</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-2.5 text-sm">
                  {Object.entries(c.customFields).map(([k, v]) => (
                    <Row key={k} label={k}>
                      {v}
                    </Row>
                  ))}
                </dl>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 text-slate-500">{label}</dt>
      <dd className="text-slate-800 min-w-0">{children}</dd>
    </div>
  );
}
