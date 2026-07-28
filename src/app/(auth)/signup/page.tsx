"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { GoogleMark } from "@/components/google-mark";

/**
 * Creates the staff account (email+password or Google) and routes into
 * mandatory MFA setup; a fresh account then lands on /no-organization to
 * create its firm + trial. Google accounts create their password during MFA
 * setup (ADR-0041); a Google email that already owns a password account
 * bounces to /login with the account_not_linked explanation (ADR-0038).
 */
export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await authClient.signUp.email({ name, email, password });
    setBusy(false);
    if (error) {
      setError(error.message ?? "Sign-up failed");
      return;
    }
    router.push("/setup-mfa");
  }

  async function googleSignUp() {
    // better-auth auto-creates the account on first Google sign-in; an email
    // that already owns a password account bounces to /login?error=
    // account_not_linked, where the message explains what happened (ADR-0038).
    await authClient.signIn.social({
      provider: "google",
      callbackURL: "/app",
      errorCallbackURL: "/login",
    });
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-6">
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
      <img src="/brand/slipyard-mark.png" alt="SlipYard" className="h-16 w-auto" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">Create your account</CardTitle>
          <CardDescription>
            You&apos;ll set up two-factor security, then your firm and free trial.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="name">Full name</Label>
              <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password (10+ characters)</Label>
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
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Creating…" : "Create account"}
            </Button>
          </form>
          <Button variant="outline" className="w-full" onClick={googleSignUp}>
            <GoogleMark /> Continue with Google
          </Button>
          <p className="text-sm text-slate-500 text-center">
            Already have an account?{" "}
            <Link href="/login" className="underline underline-offset-2">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
