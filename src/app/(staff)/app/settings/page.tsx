import Link from "next/link";
import { requireStaff } from "@/lib/context";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { billingSettings } from "@/db/schema";
import { BillingDefaultsForm, OrgProfileForm, OrgSettingsForm } from "./settings-forms";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await requireStaff();
  const canEdit = can(ctx.actor, "org.update_settings") && !ctx.readOnly;
  const billing = billingSettings(ctx.orgSettings);

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-slate-500 mt-1">{ctx.orgName}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link href="/app/settings/employees" className="group">
          <Card className="transition group-hover:border-slate-300">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Employees →</CardTitle>
              <CardDescription>Invite staff, set roles, deactivate seats.</CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/app/settings/billing" className="group">
          <Card className="transition group-hover:border-slate-300">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Billing →</CardTitle>
              <CardDescription>Subscription, payment method, invoices.</CardDescription>
            </CardHeader>
          </Card>
        </Link>
        {canEdit && (
          <Link href="/app/settings/stages" className="group">
            <Card className="transition group-hover:border-slate-300">
              <CardHeader>
                <CardTitle className="text-sm font-medium">Workflow stages →</CardTitle>
                <CardDescription>Rename, reorder, add or remove board columns.</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}
        {can(ctx.actor, "messages.manage_templates") && (
          <Link href="/app/settings/templates" className="group">
            <Card className="transition group-hover:border-slate-300">
              <CardHeader>
                <CardTitle className="text-sm font-medium">Message templates →</CardTitle>
                <CardDescription>Reusable emails/texts + automatic reminders.</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}
        {can(ctx.actor, "import.manage") && (
          <Link href="/app/settings/import" className="group">
            <Card className="transition group-hover:border-slate-300">
              <CardHeader>
                <CardTitle className="text-sm font-medium">Data import →</CardTitle>
                <CardDescription>Bulk-load clients from a CSV; map columns, review, undo.</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}
        {can(ctx.actor, "audit.view") && (
          <Link href="/app/settings/ai-usage" className="group">
            <Card className="transition group-hover:border-slate-300">
              <CardHeader>
                <CardTitle className="text-sm font-medium">AI usage →</CardTitle>
                <CardDescription>Every AI run: who asked, tools read, tokens used.</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}
        {can(ctx.actor, "documents.view") && (
          <Link href="/app/settings/retention" className="group">
            <Card className="transition group-hover:border-slate-300">
              <CardHeader>
                <CardTitle className="text-sm font-medium">Retention review →</CardTitle>
                <CardDescription>Documents past the 7-year horizon, flagged for review.</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Firm profile</CardTitle>
        </CardHeader>
        <CardContent>
          <OrgProfileForm name={ctx.orgName} timezone={ctx.timezone} disabled={!canEdit} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Preferences</CardTitle>
        </CardHeader>
        <CardContent>
          <OrgSettingsForm
            aiEnabled={ctx.orgSettings.ai_enabled}
            scopeMode={ctx.orgSettings.accountant_scope_mode}
            disabled={!canEdit}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Billing defaults</CardTitle>
          <CardDescription>
            Prefills for time entries and invoices — editable per entry either way.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BillingDefaultsForm
            hourlyRateCents={billing.hourly_rate_cents}
            taxRateBps={billing.tax_rate_bps}
            taxLabel={billing.tax_label}
            disabled={!canEdit}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Coming later</CardTitle>
          <CardDescription>Checklist templates</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
