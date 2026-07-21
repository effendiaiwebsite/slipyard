/**
 * Client portal shell. Token-gated (magic link + SMS OTP — M4); NO staff
 * chrome, NO accounts. GCDS-informed theme: 18px+ base, AAA contrast, max 3
 * actions per screen, plain language. No SIN or dollar amounts ever render
 * here.
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="portal-theme min-h-screen flex flex-col bg-white">
      <header className="border-b-4 border-[#26374a] bg-white">
        <div className="max-w-2xl mx-auto px-5 py-4">
          <span className="font-bold text-[#26374a]">Your accountant&apos;s secure portal</span>
        </div>
      </header>
      <main className="flex-1 w-full max-w-2xl mx-auto px-5 py-8">{children}</main>
      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="max-w-2xl mx-auto px-5 py-4 text-[15px] text-slate-600">
          Having trouble? Call your accountant&apos;s office — they can help over the phone.
        </div>
      </footer>
    </div>
  );
}
