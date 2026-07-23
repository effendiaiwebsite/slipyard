import { Card, CardContent } from "@/components/ui/card";
import { requireStaff } from "@/lib/context";
import { AiDisabledCard } from "../ai-disabled-card";
import { AssistantChat } from "./assistant-chat";

export const metadata = { title: "Knowledge assistant" };

/**
 * Knowledge assistant (M8): chat over the firm's practice data through
 * permission-scoped READ tools (ADR-0031). Drafts only — it can never write
 * or send anything; answers respect the caller's own view scope.
 */
export default async function AssistantPage() {
  const ctx = await requireStaff();

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Knowledge assistant</h1>
        <p className="text-sm text-slate-500 mt-1">
          Ask about your clients, returns, documents, CRA coverage, and billing. The assistant
          reads what you can see — it never changes records or sends anything.
        </p>
      </div>

      {ctx.orgSettings.ai_enabled ? (
        <Card>
          <CardContent className="p-4">
            <AssistantChat />
          </CardContent>
        </Card>
      ) : (
        <AiDisabledCard />
      )}
    </div>
  );
}
