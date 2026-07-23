"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { GoogleMark } from "@/components/google-mark";
import { acceptInviteAction } from "./actions";

export function JoinFlow({
  token,
  inviteName,
  inviteEmail,
  googleEnabled,
  sessionEmail,
}: {
  token: string;
  inviteName: string;
  inviteEmail: string;
  googleEnabled: boolean;
  sessionEmail: string | null;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function accept() {
    setError(null);
    startTransition(async () => {
      const res = await acceptInviteAction(token);
      if (res?.error) setError(res.error);
    });
  }

  // Signed in with the right email → one-click accept.
  if (sessionEmail && sessionEmail.toLowerCase() === inviteEmail.toLowerCase()) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          Signed in as <strong>{sessionEmail}</strong>.
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button className="w-full" onClick={accept} disabled={pending}>
          {pending ? "Joining…" : "Accept invitation"}
        </Button>
      </div>
    );
  }

  // Signed in as someone else.
  if (sessionEmail) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          This invitation is for <strong>{inviteEmail}</strong>, but you&apos;re signed in as{" "}
          <strong>{sessionEmail}</strong>.
        </p>
        <Button
          variant="outline"
          className="w-full"
          onClick={async () => {
            await authClient.signOut();
            window.location.reload();
          }}
        >
          Sign out and start over
        </Button>
      </div>
    );
  }

  // Not signed in → create the account with the invited email (locked).
  async function signUpAndAccept(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { error: suError } = await authClient.signUp.email({
      name: inviteName,
      email: inviteEmail,
      password,
    });
    if (suError) {
      setError(
        suError.message?.includes("existing")
          ? "An account with this email already exists — sign in first, then re-open this link."
          : (suError.message ?? "Could not create the account")
      );
      return;
    }
    accept();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={signUpAndAccept} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" value={inviteEmail} disabled />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Choose a password (10+ characters)</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Joining…" : "Create account and join"}
        </Button>
      </form>
      {googleEnabled && (
        <Button
          variant="outline"
          className="w-full"
          onClick={() =>
            authClient.signIn.social({
              provider: "google",
              callbackURL: `/join/${token}`,
              errorCallbackURL: `/join/${token}`,
            })
          }
        >
          <GoogleMark /> Continue with Google
        </Button>
      )}
      <p className="text-xs text-slate-500">
        Already have an account with this email? Sign in at{" "}
        <a href="/login" className="underline underline-offset-2">
          /login
        </a>{" "}
        and re-open this invitation link.
      </p>
    </div>
  );
}
