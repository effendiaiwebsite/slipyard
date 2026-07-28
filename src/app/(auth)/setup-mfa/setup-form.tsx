"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { setInitialPassword } from "./actions";

/**
 * Mandatory TOTP enrollment. requireStaff() redirects every session here
 * until twoFactorEnabled is true — there is no path into /app without it.
 *
 * Google-only accounts have no password, which twoFactor.enable requires —
 * for them the first step CREATES one (ADR-0041), then enrollment proceeds
 * identically.
 */
export function SetupMfaForm({ needsPassword }: { needsPassword: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<"password" | "scan">("password");
  const [password, setPassword] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function begin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (needsPassword) {
      const res = await setInitialPassword(password);
      if (res.error) {
        setBusy(false);
        setError(res.error);
        return;
      }
    }
    const { data, error } = await authClient.twoFactor.enable({ password });
    setBusy(false);
    if (error || !data) {
      setError(error?.message ?? "Could not start two-factor setup");
      return;
    }
    setTotpUri(data.totpURI);
    setBackupCodes(data.backupCodes ?? []);
    setQrDataUrl(await QRCode.toDataURL(data.totpURI, { width: 220, margin: 1 }));
    setStep("scan");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    setBusy(false);
    if (error) {
      setError("That code didn't match. Check your authenticator app and try again.");
      return;
    }
    router.push("/app");
  }

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-lg">Set up two-factor authentication</CardTitle>
          <CardDescription>
            Required for all staff. You&apos;ll need an authenticator app (Google Authenticator,
            1Password, Microsoft Authenticator…).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === "password" && (
            <form onSubmit={begin} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="password">
                  {needsPassword ? "Create a password (10+ characters)" : "Confirm your password"}
                </Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={needsPassword ? "new-password" : "current-password"}
                  minLength={needsPassword ? 10 : undefined}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {needsPassword && (
                  <p className="text-xs text-slate-500">
                    You signed up with Google, which doesn&apos;t set a password. Create one now to
                    protect your authenticator setup — you can keep signing in with Google, and the
                    password also works with your authenticator code if you ever lose Google access.
                  </p>
                )}
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Preparing…" : "Continue"}
              </Button>
            </form>
          )}

          {step === "scan" && (
            <form onSubmit={verify} className="space-y-4">
              <div className="flex flex-col items-center gap-3">
                {qrDataUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qrDataUrl} alt="TOTP QR code" className="rounded-md ring-1 ring-slate-200" />
                )}
                {totpUri && (
                  <details className="text-xs text-slate-500 max-w-full">
                    <summary className="cursor-pointer">Can&apos;t scan? Enter manually</summary>
                    <code className="block mt-1 break-all">{totpUri}</code>
                  </details>
                )}
              </div>
              {backupCodes.length > 0 && (
                <div className="rounded-md bg-slate-50 ring-1 ring-slate-200 p-3">
                  <p className="text-xs font-medium text-slate-700 mb-1.5">
                    Backup codes — store these somewhere safe. Each works once.
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-xs text-slate-600">
                    {backupCodes.map((c) => (
                      <span key={c}>{c}</span>
                    ))}
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="code">6-digit code from your app</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Verifying…" : "Verify and finish"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
