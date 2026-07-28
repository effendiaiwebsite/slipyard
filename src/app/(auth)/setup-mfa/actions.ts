"use server";

import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/context";

/**
 * Google-only accounts (no credential row) must create a password before
 * mandatory TOTP enrollment, because better-auth's twoFactor.enable verifies
 * one (ADR-0041). Auth tables are global and non-org-scoped by design, so the
 * raw db handle is the sanctioned path here (ADR-0039 precedent) — and the
 * target account comes from the session, never from user input.
 */
export async function setInitialPassword(newPassword: string): Promise<{ error?: string }> {
  const session = await requireSession();

  const parsed = z.string().min(10).max(128).safeParse(newPassword);
  if (!parsed.success) return { error: "Password must be 10 to 128 characters." };

  const credential = await db
    .select({ id: schema.authAccount.id })
    .from(schema.authAccount)
    .where(
      and(
        eq(schema.authAccount.userId, session.user.id),
        eq(schema.authAccount.providerId, "credential")
      )
    );
  // Already set (e.g. a retry after a failed enable step): not an error — the
  // enable call will verify whatever password the account actually has.
  if (credential.length > 0) return {};

  try {
    await auth.api.setPassword({
      body: { newPassword: parsed.data },
      headers: await headers(),
    });
  } catch {
    return { error: "Couldn't set the password — try again." };
  }
  return {};
}
