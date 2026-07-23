import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { viewAssignedOnlyFilter } from "@/lib/clients";
import { requireStaff } from "@/lib/context";
import { AiDisabledCard } from "../ai-disabled-card";
import { EmailDrafter } from "./email-drafter";

export const metadata = { title: "Email drafts" };

/**
 * Email drafts (M8): the AI writes, the human reviews, edits, and — only if
 * they choose to — sends through the normal M5 messaging path. Drafts never
 * auto-send (ADR-0031).
 */
export default async function EmailDraftsPage() {
  const ctx = await requireStaff();
  const assignedOnly = viewAssignedOnlyFilter(ctx);
  const clients = ctx.orgSettings.ai_enabled
    ? await ctx.scope.listClientsWithMeta({
        status: "active",
        ...(assignedOnly ? { assignedToId: assignedOnly } : {}),
      })
    : [];

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Email drafts</h1>
        <p className="text-sm text-slate-500 mt-1">
          Draft a client email grounded in what&apos;s on file. You review and edit every draft —
          nothing sends until you say so.
        </p>
      </div>

      {ctx.orgSettings.ai_enabled ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Draft an email</CardTitle>
          </CardHeader>
          <CardContent>
            <EmailDrafter
              clients={clients.map((c) => ({
                id: c.client.id,
                name: c.client.displayName,
                hasEmail: !!c.client.email,
              }))}
            />
          </CardContent>
        </Card>
      ) : (
        <AiDisabledCard />
      )}
    </div>
  );
}
