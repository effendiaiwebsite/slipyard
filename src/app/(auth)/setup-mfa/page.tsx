import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/context";
import { SetupMfaForm } from "./setup-form";

export const metadata = { title: "Set up two-factor" };

/**
 * Server shell: decides whether this session's account has a password.
 * Google-only accounts don't, and twoFactor.enable requires one — the form's
 * first step creates it (ADR-0041). Auth tables are global/non-org-scoped, so
 * the raw db handle is sanctioned here (ADR-0039 precedent).
 */
export default async function SetupMfaPage() {
  const session = await requireSession();
  const credential = await db
    .select({ id: schema.authAccount.id })
    .from(schema.authAccount)
    .where(
      and(
        eq(schema.authAccount.userId, session.user.id),
        eq(schema.authAccount.providerId, "credential")
      )
    );
  return <SetupMfaForm needsPassword={credential.length === 0} />;
}
