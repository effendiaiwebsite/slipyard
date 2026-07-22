import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireStaff } from "@/lib/context";
import { can } from "@/lib/permissions";
import { MassSendComposer, type RecipientRow, type TemplateOption } from "./mass-send";

export const metadata = { title: "Messaging" };

/**
 * Messaging (M5): mass send composer + the send log. Sends are per-recipient
 * `message` rows (skips included) transported by the message-send job; the
 * log below is the org's recent history, newest first.
 */
export default async function MessagingPage() {
  const ctx = await requireStaff();
  const [templates, clients, missingItems, recent] = await Promise.all([
    ctx.scope.listMessageTemplates(),
    ctx.scope.listClientsWithMeta({ status: "active" }),
    ctx.scope.listMissingChecklistItems(),
    ctx.scope.listRecentMessages(100),
  ]);

  const missingByEngagement = new Map<string, string[]>();
  for (const item of missingItems) {
    if (!item.required) continue;
    const list = missingByEngagement.get(item.engagementId) ?? [];
    list.push(item.title);
    missingByEngagement.set(item.engagementId, list);
  }

  const templateOptions: TemplateOption[] = templates
    .filter((t) => !t.archivedAt)
    .map((t) => ({ id: t.id, name: t.name, channel: t.channel, subject: t.subject, body: t.body }));

  const recipients: RecipientRow[] = clients.map((r) => ({
    id: r.client.id,
    name: r.client.displayName,
    type: r.client.type,
    hasEmail: !!r.client.email,
    hasPhone: !!r.client.phone,
    smsOptedOut: r.client.smsOptOutAt !== null,
    stageCategory: r.latestEngagement?.stage.category ?? null,
    stageLabel: r.latestEngagement?.stage.label ?? null,
    taxYear: r.latestEngagement?.engagement.taxYear ?? null,
    missingTitles: r.latestEngagement
      ? (missingByEngagement.get(r.latestEngagement.engagement.id) ?? [])
      : [],
    accountantName: r.assignedName,
  }));

  const canSend = can(ctx.actor, "messages.send_templated") && !ctx.readOnly;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Messaging</h1>
        <p className="text-sm text-slate-600 mt-1">
          Send a templated email or text to a filtered group of clients. Every send lands on the
          client&apos;s contact timeline; texts respect STOP opt-outs automatically.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Mass send</CardTitle>
          <CardDescription>
            Templates live in Settings → Message templates. Clients without a usable address (or
            who opted out of texts) are skipped and listed in the log.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MassSendComposer
            templates={templateOptions}
            recipients={recipients}
            firmName={ctx.orgName}
            canSend={canSend}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Send log</CardTitle>
        </CardHeader>
        <CardContent>
          <SendLog rows={recent} />
        </CardContent>
      </Card>
    </div>
  );
}

const STATUS_BADGE = {
  queued: { label: "Queued", variant: "default" as const },
  sent: { label: "Sent", variant: "success" as const },
  failed: { label: "Failed", variant: "danger" as const },
  skipped: { label: "Skipped", variant: "warn" as const },
};

const KIND_LABEL = { manual: "One-off", mass: "Mass send", reminder: "Reminder" };

const SKIP_LABEL: Record<string, string> = {
  sms_opt_out: "opted out of texts",
  no_address: "no usable address",
};

function SendLog({
  rows,
}: {
  rows: Awaited<ReturnType<Awaited<ReturnType<typeof requireStaff>>["scope"]["listRecentMessages"]>>;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-400">Nothing sent yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
            <th className="py-1.5 pr-3 font-medium">When</th>
            <th className="py-1.5 pr-3 font-medium">Client</th>
            <th className="py-1.5 pr-3 font-medium">What</th>
            <th className="py-1.5 pr-3 font-medium">Channel</th>
            <th className="py-1.5 pr-3 font-medium">Status</th>
            <th className="py-1.5 font-medium">By</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const status = STATUS_BADGE[r.message.status];
            return (
              <tr key={r.message.id} className="border-b border-slate-50 last:border-0">
                <td className="py-1.5 pr-3 text-slate-500 whitespace-nowrap">
                  {r.message.createdAt.toLocaleString("en-CA", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </td>
                <td className="py-1.5 pr-3 text-slate-800">{r.clientName}</td>
                <td className="py-1.5 pr-3 text-slate-600">
                  {r.templateName ?? r.message.subject ?? "—"}
                  <span className="text-xs text-slate-400"> · {KIND_LABEL[r.message.kind]}</span>
                </td>
                <td className="py-1.5 pr-3 text-slate-600">
                  {r.message.channel === "email" ? "Email" : "Text"}
                </td>
                <td className="py-1.5 pr-3">
                  <Badge variant={status.variant}>{status.label}</Badge>
                  {r.message.status === "skipped" && r.message.skipReason && (
                    <span className="text-xs text-slate-400 ml-1.5">
                      {SKIP_LABEL[r.message.skipReason] ?? r.message.skipReason}
                    </span>
                  )}
                  {r.message.status === "failed" && r.message.error && (
                    <span className="text-xs text-red-500 ml-1.5" title={r.message.error}>
                      {r.message.error.slice(0, 60)}
                    </span>
                  )}
                </td>
                <td className="py-1.5 text-slate-500">{r.senderName ?? "Automatic"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
