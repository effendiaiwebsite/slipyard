/**
 * M0 placeholder. From M4 this page only renders behind a valid magic-link
 * token + SMS code, showing the three cards: Send us a document / What we
 * still need / Sign a form.
 */
export default function PortalHomePage() {
  return (
    <div className="space-y-6">
      <h1>This link isn&apos;t ready yet</h1>
      <p>
        To use this secure portal, you need a personal link from your accountant. They will send
        it to you by text message or email.
      </p>
      <p>
        If you were expecting a link and don&apos;t have one, please call your accountant&apos;s
        office.
      </p>
    </div>
  );
}
