"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createOrgForUser } from "@/db/scoped";
import { requireSession } from "@/lib/context";
import { logger } from "@/lib/logger";

const CANADA_TIMEZONES = [
  "America/St_Johns",
  "America/Halifax",
  "America/Toronto",
  "America/Winnipeg",
  "America/Regina",
  "America/Edmonton",
  "America/Vancouver",
] as const;

const schema = z.object({
  name: z.string().trim().min(2, "Firm name must be at least 2 characters").max(120),
  timezone: z.enum(CANADA_TIMEZONES),
});

export async function createFirm(_prev: { error?: string } | null, formData: FormData) {
  const session = await requireSession();
  const parsed = schema.safeParse({
    name: formData.get("name"),
    timezone: formData.get("timezone"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const orgId = await createOrgForUser(session.user.id, parsed.data.name, parsed.data.timezone);
  logger.info({ orgId, userId: session.user.id }, "org created");
  redirect("/app");
}
