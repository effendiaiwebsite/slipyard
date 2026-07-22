"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Option = { id: string; name: string };

export type ClientFormValues = {
  displayName: string;
  type: "individual" | "corporation" | "trust";
  email: string;
  phone: string;
  preferredChannel: "email" | "sms" | "phone" | "mail";
  addressLine1: string;
  city: string;
  province: string;
  postalCode: string;
  dateOfBirth: string;
  assignedAccountantId: string;
  householdId: string;
  tags: string;
  sinOnFile: boolean;
};

type ActionResult = { error?: string; ok?: boolean; clientId?: string } | null;

const EMPTY: ClientFormValues = {
  displayName: "",
  type: "individual",
  email: "",
  phone: "",
  preferredChannel: "phone",
  addressLine1: "",
  city: "",
  province: "",
  postalCode: "",
  dateOfBirth: "",
  assignedAccountantId: "",
  householdId: "",
  tags: "",
  sinOnFile: false,
};

export function ClientForm({
  action,
  initial,
  members,
  households,
  submitLabel,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  initial?: Partial<ClientFormValues>;
  members: Option[];
  households: Option[];
  submitLabel: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, null);
  const v = { ...EMPTY, ...initial };

  useEffect(() => {
    if (state?.ok && state.clientId) router.push(`/app/clients/${state.clientId}`);
  }, [state, router]);

  const selectCls =
    "w-full h-9 px-3 text-sm rounded-md bg-white ring-1 ring-slate-200 focus:ring-slate-400 outline-none";

  return (
    <form action={formAction} className="space-y-5 max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="displayName">Name *</Label>
          <Input id="displayName" name="displayName" defaultValue={v.displayName} required minLength={2} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="type">Type</Label>
          <select id="type" name="type" defaultValue={v.type} className={selectCls}>
            <option value="individual">Individual</option>
            <option value="corporation">Corporation</option>
            <option value="trust">Trust</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="preferredChannel">Preferred contact</Label>
          <select id="preferredChannel" name="preferredChannel" defaultValue={v.preferredChannel} className={selectCls}>
            <option value="phone">Phone</option>
            <option value="email">Email</option>
            <option value="sms">SMS / text</option>
            <option value="mail">Paper mail</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" defaultValue={v.email} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Mobile / phone (+1…)</Label>
          <Input id="phone" name="phone" placeholder="+14165551234" defaultValue={v.phone} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="addressLine1">Address</Label>
          <Input id="addressLine1" name="addressLine1" defaultValue={v.addressLine1} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="city">City</Label>
          <Input id="city" name="city" defaultValue={v.city} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="province">Province</Label>
            <Input id="province" name="province" placeholder="ON" maxLength={2} defaultValue={v.province} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="postalCode">Postal code</Label>
            <Input id="postalCode" name="postalCode" defaultValue={v.postalCode} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dateOfBirth">Date of birth</Label>
          <Input id="dateOfBirth" name="dateOfBirth" type="date" defaultValue={v.dateOfBirth} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sin">SIN {v.sinOnFile && <span className="text-slate-400">(on file — enter to replace)</span>}</Label>
          <Input
            id="sin"
            name="sin"
            inputMode="numeric"
            autoComplete="off"
            placeholder={v.sinOnFile ? "•••••••••" : "9 digits"}
          />
          <p className="text-xs text-slate-400">Stored encrypted; only the last 3 digits are ever shown.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="assignedAccountantId">Assigned accountant</Label>
          <select id="assignedAccountantId" name="assignedAccountantId" defaultValue={v.assignedAccountantId} className={selectCls}>
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="householdId">Household</Label>
          <select id="householdId" name="householdId" defaultValue={v.householdId} className={selectCls}>
            <option value="">None</option>
            {households.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
          <Input name="newHouseholdName" placeholder="…or create a new household" className="mt-1.5" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="tags">Tags (comma-separated)</Label>
          <Input id="tags" name="tags" placeholder="senior, paper-mail" defaultValue={v.tags} />
        </div>
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
