"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const idleNotice = params.get("reason") === "idle";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await authClient.signIn.email({ email, password });
    setBusy(false);
    if (error) {
      setError(error.message ?? "Sign-in failed");
      return;
    }
    // Users with 2FA enrolled are redirected to /verify-mfa by the
    // twoFactorClient plugin; the check below covers first login (not yet
    // enrolled), which requireStaff would also catch server-side.
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) return;
    router.push("/app");
  }

  async function googleSignIn() {
    await authClient.signIn.social({ provider: "google", callbackURL: "/app" });
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-lg">Sign in</CardTitle>
        <CardDescription>Staff access — clients use the secure link we send them.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {idleNotice && (
          <p className="text-sm rounded-md bg-amber-50 text-amber-800 ring-1 ring-amber-200 px-3 py-2">
            You were signed out after 30 minutes of inactivity.
          </p>
        )}
        <form onSubmit={onSubmit} className="space-y-3">
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
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <Button variant="outline" className="w-full" onClick={googleSignIn}>
          Continue with Google
        </Button>
        <p className="text-sm text-slate-500 text-center">
          New firm?{" "}
          <Link href="/signup" className="underline underline-offset-2">
            Create an account
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-screen grid place-items-center p-6">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
