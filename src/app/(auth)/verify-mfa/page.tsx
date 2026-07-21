"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export default function VerifyMfaPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code });
    setBusy(false);
    if (error) {
      setError("That code didn't match. Try again.");
      return;
    }
    router.push("/app");
  }

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">Two-factor check</CardTitle>
          <CardDescription>
            {useBackup
              ? "Enter one of your single-use backup codes."
              : "Enter the 6-digit code from your authenticator app."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="code">{useBackup ? "Backup code" : "6-digit code"}</Label>
              <Input
                id="code"
                inputMode={useBackup ? "text" : "numeric"}
                autoFocus
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Checking…" : "Verify"}
            </Button>
          </form>
          <button
            className="text-sm text-slate-500 underline underline-offset-2 w-full text-center"
            onClick={() => {
              setUseBackup((v) => !v);
              setCode("");
              setError(null);
            }}
          >
            {useBackup ? "Use authenticator code instead" : "Lost your device? Use a backup code"}
          </button>
        </CardContent>
      </Card>
    </main>
  );
}
