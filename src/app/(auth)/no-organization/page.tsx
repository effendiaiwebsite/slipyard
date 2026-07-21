import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/lib/context";
import { CreateFirmForm } from "./create-firm-form";

export default async function NoOrganizationPage() {
  const session = await requireSession();

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-lg">Set up your firm</CardTitle>
          <CardDescription>
            {session.user.email} isn&apos;t part of a firm yet. Create one to start your 14-day
            free trial — no credit card needed until the trial ends.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CreateFirmForm />
          <p className="text-sm text-slate-500">
            Joining an existing firm? Ask an owner or administrator to send you an invitation
            link instead.
          </p>
          <p className="text-sm text-slate-500">
            <Link href="/login" className="underline underline-offset-2">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
