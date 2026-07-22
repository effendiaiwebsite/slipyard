import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { reminderSettings } from "@/db/schema";
import { requireStaff } from "@/lib/context";
import { can } from "@/lib/permissions";
import { TEMPLATE_VARIABLES } from "@/lib/templates";
import { ReminderPolicyForm, TemplatesManager } from "./templates-manager";

export const metadata = { title: "Message templates" };

export default async function TemplatesSettingsPage() {
  const ctx = await requireStaff();
  if (!can(ctx.actor, "messages.manage_templates")) redirect("/app/settings");

  const templates = await ctx.scope.listMessageTemplates();
  const rows = templates.map((t) => ({
    id: t.id,
    name: t.name,
    channel: t.channel,
    subject: t.subject,
    body: t.body,
    archived: t.archivedAt !== null,
  }));
  const policy = reminderSettings(ctx.orgSettings);

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <div className="text-xs text-slate-500 mb-0.5">
          <Link href="/app/settings" className="hover:underline">
            Settings
          </Link>{" "}
          · Message templates
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Message templates</h1>
        <p className="text-sm text-slate-600 mt-1">
          Reusable emails and texts for reminders and mass sends. Placeholders like{" "}
          <code className="text-xs bg-slate-100 px-1 rounded">{"{client_name}"}</code> fill in per
          client when a message goes out.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Templates</CardTitle>
        </CardHeader>
        <CardContent>
          <TemplatesManager templates={rows} variables={TEMPLATE_VARIABLES} disabled={ctx.readOnly} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Automatic reminders</CardTitle>
          <CardDescription>
            Nudges clients whose return is waiting on documents. Works off the stage&apos;s{" "}
            <em>meaning</em>, so renaming stages never breaks it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ReminderPolicyForm
            policy={policy}
            templates={rows}
            disabled={ctx.readOnly || !can(ctx.actor, "org.update_settings")}
          />
        </CardContent>
      </Card>
    </div>
  );
}
