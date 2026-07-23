"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createInvoiceForClient,
  deleteTimeEntry,
  recordTimeEntry,
  setInvoiceStatusAction,
  type BillingActionResult,
} from "./actions";

type Option = { id: string; name: string };
type EngagementOption = { id: string; clientId: string; label: string };

const selectCls =
  "h-8 px-2 text-xs rounded-md bg-white ring-1 ring-slate-200 focus:ring-slate-400 outline-none";

export function RecordTimeForm({
  clients,
  engagements,
  defaultRate,
  defaultDate,
}: {
  clients: Option[];
  engagements: EngagementOption[];
  /** Dollars per hour prefill (org billing default). */
  defaultRate: number;
  /** Today (server-rendered, org perspective) as YYYY-MM-DD. */
  defaultDate: string;
}) {
  const [state, formAction, pending] = useActionState(recordTimeEntry, null);
  const [clientId, setClientId] = useState("");
  const clientEngagements = engagements.filter((e) => e.clientId === clientId);

  return (
    <form action={formAction} className="flex items-center gap-2 flex-wrap">
      <select
        name="clientId"
        required
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        className={selectCls}
      >
        <option value="" disabled>
          Client…
        </option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select name="engagementId" className={selectCls} defaultValue="">
        <option value="">No engagement</option>
        {clientEngagements.map((e) => (
          <option key={e.id} value={e.id}>
            {e.label}
          </option>
        ))}
      </select>
      <Input name="workDate" type="date" required defaultValue={defaultDate} className="h-8 w-36 text-xs" />
      <Input
        name="hours"
        type="number"
        step="0.25"
        min="0.25"
        max="24"
        required
        placeholder="Hours"
        aria-label="Hours"
        className="h-8 w-20 text-xs"
      />
      <Input
        name="rate"
        type="number"
        step="1"
        min="0"
        required
        defaultValue={defaultRate}
        aria-label="Hourly rate (dollars)"
        title="Hourly rate ($/h)"
        className="h-8 w-20 text-xs"
      />
      <input
        name="description"
        required
        placeholder="What did you work on?"
        className="flex-1 min-w-48 h-8 px-2 text-xs rounded-md bg-slate-50 ring-1 ring-slate-200 focus:bg-white focus:ring-slate-400 outline-none"
      />
      <Button size="sm" type="submit" disabled={pending}>
        {pending ? "Saving…" : "Record time"}
      </Button>
      {state?.error && <span className="text-xs text-red-600 w-full">{state.error}</span>}
    </form>
  );
}

export function CreateInvoiceButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await createInvoiceForClient(clientId);
            if (res?.error) setError(res.error);
            else if (res?.invoiceId) router.push(`/app/billing/invoices/${res.invoiceId}`);
          })
        }
      >
        {isPending ? "Creating…" : "Create invoice"}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

export function DeleteEntryButton({ entryId }: { entryId: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      disabled={isPending}
      onClick={() => startTransition(() => void deleteTimeEntry(entryId))}
      className="text-xs text-slate-400 hover:text-red-600 underline underline-offset-2 disabled:opacity-50"
    >
      Remove
    </button>
  );
}

export function InvoiceStatusButtons({
  invoiceId,
  status,
}: {
  invoiceId: string;
  status: "draft" | "sent" | "paid" | "void";
}) {
  const [state, setState] = useState<BillingActionResult>(null);
  const [isPending, startTransition] = useTransition();
  const act = (to: "sent" | "paid" | "void") =>
    startTransition(async () => setState(await setInvoiceStatusAction(invoiceId, to)));

  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      {status === "draft" && (
        <Button size="sm" disabled={isPending} onClick={() => act("sent")}>
          Mark sent
        </Button>
      )}
      {status === "sent" && (
        <Button size="sm" disabled={isPending} onClick={() => act("paid")}>
          Mark paid
        </Button>
      )}
      {(status === "draft" || status === "sent") && (
        <Button size="sm" variant="outline" disabled={isPending} onClick={() => act("void")}>
          Void
        </Button>
      )}
      {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
    </span>
  );
}
