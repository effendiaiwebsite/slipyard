import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/lib/context";

export default async function NoOrganizationPage() {
  const session = await requireSession();

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-lg">No firm yet</CardTitle>
          <CardDescription>
            {session.user.email} isn&apos;t a member of any firm on this platform.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-slate-600 space-y-3">
          <p>
            Firm creation with a 14-day trial arrives in the next milestone (M1). If your firm
            already uses this platform, ask an owner or administrator to send you an invitation.
          </p>
          <p>
            <Link href="/login" className="underline underline-offset-2">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
