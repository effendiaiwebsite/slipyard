import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Marketing landing stub — real pricing/marketing content lands in M10. */
export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="border-b border-[var(--color-border)] bg-white">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white font-bold text-xs">
              A
            </div>
            <span className="font-semibold text-sm tracking-tight">Accountant CRM</span>
          </div>
          <nav className="flex items-center gap-3">
            <Button variant="ghost" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild>
              <Link href="/signup">Start free trial</Link>
            </Button>
          </nav>
        </div>
      </header>
      <section className="flex-1 grid place-items-center px-6 py-20">
        <div className="max-w-2xl text-center space-y-5">
          <h1 className="text-4xl font-semibold tracking-tight text-slate-900">
            The practice CRM built for Canadian accounting firms
          </h1>
          <p className="text-lg text-slate-600">
            Client documents, e-signatures, CRA authorizations, and season workflow — beside your
            tax software, with a client portal your most technology-shy clients can actually use.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button size="lg" asChild>
              <Link href="/signup">Start a 14-day trial</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/login">Staff sign in</Link>
            </Button>
          </div>
          <p className="text-sm text-slate-400">
            Monthly per-seat pricing. Data stored in Canada (ca-central-1).
          </p>
        </div>
      </section>
    </main>
  );
}
