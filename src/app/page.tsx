import Link from "next/link";
import {
  Bot,
  FileCheck2,
  FileSignature,
  FolderLock,
  MessageSquareText,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Marketing landing (M10). Deliberately a single static page — the product
 * sells firm-to-firm; this page exists so a prospective firm landing on the
 * domain sees what it is, what it costs, and where the trial starts.
 */

const FEATURES = [
  {
    icon: FolderLock,
    title: "Document vault & checklists",
    body: "Every upload is virus-scanned into an encrypted vault in Canada. Per-return checklists show exactly what's still missing.",
  },
  {
    icon: MessageSquareText,
    title: "A portal clients actually use",
    body: "Big type, plain language, no passwords — a text-message link and a code. Clients photograph slips with guided capture.",
  },
  {
    icon: FileSignature,
    title: "E-signatures with a CRA-ready trail",
    body: "Place fields on the real form, sign remotely or in person, and keep an immutable executed PDF with a full audit page.",
  },
  {
    icon: FileCheck2,
    title: "CRA authorizations & AFR reconciliation",
    body: "See authorization coverage at a glance, and reconcile CRA Auto-fill slip data against what's on file before you file.",
  },
  {
    icon: Bot,
    title: "AI that drafts, never acts",
    body: "Practice assistant, email drafts and meeting prep — scoped to what the asking staff member may see. It never sends or changes records.",
  },
  {
    icon: ShieldCheck,
    title: "Serious about tenancy & privacy",
    body: "Row-level security per firm, role-based permissions with a full audit log, SINs encrypted at the application layer.",
  },
];

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

      <section className="px-6 pt-20 pb-14">
        <div className="max-w-2xl mx-auto text-center space-y-5">
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
            No card required for the trial. Data stored in Canada (ca-central-1).
          </p>
        </div>
      </section>

      <section className="px-6 pb-16">
        <div className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-slate-200 bg-white p-5">
              <f.icon className="w-5 h-5 text-indigo-600" aria-hidden />
              <h2 className="mt-3 font-semibold text-sm text-slate-900">{f.title}</h2>
              <p className="mt-1.5 text-sm text-slate-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="px-6 pb-20">
        <div className="max-w-md mx-auto rounded-2xl border border-slate-200 bg-white p-8 text-center space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            Simple pricing
          </h2>
          <p>
            <span className="text-4xl font-semibold tracking-tight text-slate-900">$300</span>
            <span className="text-slate-500"> / month per firm</span>
          </p>
          <ul className="text-sm text-slate-600 space-y-1.5">
            <li>Every feature, every plan — nothing gated</li>
            <li>Unlimited staff, clients, and portal links</li>
            <li>14-day free trial, cancel any time</li>
          </ul>
          <Button size="lg" className="w-full" asChild>
            <Link href="/signup">Start your trial</Link>
          </Button>
        </div>
      </section>

      <footer className="mt-auto border-t border-[var(--color-border)] bg-white">
        <div className="max-w-5xl mx-auto px-6 py-6 text-xs text-slate-400 flex items-center justify-between flex-wrap gap-2">
          <span>Accountant CRM — a practice CRM for Canadian firms.</span>
          <span>Data resident in Canada · SIN encrypted · Not tax software</span>
        </div>
      </footer>
    </main>
  );
}
