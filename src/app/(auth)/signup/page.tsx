"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

/**
 * M0 stub: creates the staff account and routes into MFA setup. Org creation
 * + Stripe trial arrive in M1 — until then a fresh account lands on
 * /no-organization after MFA enrollment.
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

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">Create your account</CardTitle>
          <CardDescription>
            Firm setup and subscription arrive in the next milestone (M1).
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
