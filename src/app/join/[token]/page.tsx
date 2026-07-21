import { headers } from "next/headers";
import Link from "next/link";
import { findInvitationByTokenHash } from "@/db/scoped";
import { auth } from "@/lib/auth";
import { features } from "@/lib/env";
import { hashInviteToken, invitationProblem } from "@/lib/invites";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { JoinFlow } from "./join-flow";

export const metadata = { title: "Join your firm" };

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await findInvitationByTokenHash(hashInviteToken(token));
  const problem = invitationProblem(found?.invitation);

  if (!found || problem) {
    return (
      <main className="min-h-screen grid place-items-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-lg">Invitation unavailable</CardTitle>
            <CardDescription>{problem ?? "This invitation link isn't valid."}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-500">
              <Link href="/login" className="underline underline-offset-2">
                Go to sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  const inv = found.invitation;
  const session = await auth.api.getSession({ headers: await headers() });

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-lg">Join {found.orgName}</CardTitle>
          <CardDescription>
            You&apos;ve been invited as <strong>{inv.role}</strong>. This link expires{" "}
            {inv.expiresAt.toLocaleDateString("en-CA")}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <JoinFlow
            token={token}
            inviteName={inv.name}
            inviteEmail={inv.email}
            googleEnabled={features.googleOAuth}
            sessionEmail={session?.user.email ?? null}
          />
        </CardContent>
      </Card>
    </main>
  );
}
