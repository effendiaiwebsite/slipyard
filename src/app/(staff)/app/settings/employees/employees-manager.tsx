"use client";

import { useActionState, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changeMemberRole, inviteEmployee, revokeInvitation, setMemberStatus } from "./actions";

type Member = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "accountant" | "clerk";
  status: "active" | "deactivated";
  isSelf: boolean;
};

type PendingInvite = {
  id: string;
  name: string;
  email: string;
  role: string;
  expiresAt: string;
  revoked: boolean;
};

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Administrator",
  accountant: "Accountant",
  clerk: "Clerk",
};

export function EmployeesManager({
  members,
  pendingInvites,
  canManage,
  isOwner,
  readOnly,
}: {
  members: Member[];
  pendingInvites: PendingInvite[];
  canManage: boolean;
  isOwner: boolean;
  readOnly: boolean;
}) {
  const [inviteState, inviteAction, invitePending] = useActionState(inviteEmployee, null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const disabled = !canManage || readOnly;

  function run(fn: () => Promise<{ error?: string }>) {
    setRowError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setRowError(res.error);
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Team</CardTitle>
        </CardHeader>
        <CardContent>
          {rowError && <p className="text-sm text-red-600 mb-3">{rowError}</p>}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Email</th>
                <th className="py-2 pr-4 font-medium">Role</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                {canManage && <th className="py-2 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.membershipId} className="border-b border-slate-50">
                  <td className="py-2.5 pr-4 font-medium">
                    {m.name}
                    {m.isSelf && <span className="text-slate-400 font-normal"> (you)</span>}
                  </td>
                  <td className="py-2.5 pr-4 text-slate-600">{m.email}</td>
                  <td className="py-2.5 pr-4">
                    {canManage && !m.isSelf ? (
                      <select
                        defaultValue={m.role}
                        disabled={disabled || (m.role === "owner" && !isOwner)}
                        onChange={(e) => run(() => changeMemberRole(m.membershipId, e.target.value))}
                        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm"
                      >
                        {Object.entries(ROLE_LABELS).map(([value, label]) => (
                          <option key={value} value={value} disabled={value === "owner" && !isOwner}>
                            {label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Badge variant={m.role === "owner" ? "accent" : "default"}>
                        {ROLE_LABELS[m.role]}
                      </Badge>
                    )}
                  </td>
                  <td className="py-2.5 pr-4">
                    <Badge variant={m.status === "active" ? "success" : "danger"}>{m.status}</Badge>
                  </td>
                  {canManage && (
                    <td className="py-2.5">
                      {!m.isSelf && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={disabled}
                          onClick={() =>
                            run(() =>
                              setMemberStatus(
                                m.membershipId,
                                m.status === "active" ? "deactivated" : "active"
                              )
                            )
                          }
                        >
                          {m.status === "active" ? "Deactivate" : "Reactivate"}
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {pendingInvites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Pending invitations</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <tbody>
                {pendingInvites.map((i) => (
                  <tr key={i.id} className="border-b border-slate-50">
                    <td className="py-2.5 pr-4 font-medium">{i.name}</td>
                    <td className="py-2.5 pr-4 text-slate-600">{i.email}</td>
                    <td className="py-2.5 pr-4">
                      <Badge>{ROLE_LABELS[i.role] ?? i.role}</Badge>
                    </td>
                    <td className="py-2.5 pr-4 text-slate-500">
                      {i.revoked
                        ? "revoked"
                        : `expires ${new Date(i.expiresAt).toLocaleDateString("en-CA")}`}
                    </td>
                    <td className="py-2.5">
                      {!i.revoked && canManage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={disabled}
                          onClick={() => run(() => revokeInvitation(i.id))}
                        >
                          Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Invite an employee</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={inviteAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="inv-name">Full name</Label>
                <Input id="inv-name" name="name" required disabled={disabled} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inv-email">Email</Label>
                <Input id="inv-email" name="email" type="email" required disabled={disabled} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inv-phone">Mobile (optional, for SMS invite)</Label>
                <Input id="inv-phone" name="phone" placeholder="+14165551234" disabled={disabled} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inv-role">Role</Label>
                <select
                  id="inv-role"
                  name="role"
                  defaultValue="accountant"
                  disabled={disabled}
                  className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm"
                >
                  <option value="admin">Administrator</option>
                  <option value="accountant">Accountant</option>
                  <option value="clerk">Clerk</option>
                </select>
              </div>
              <div className="sm:col-span-2 flex items-center gap-3">
                <Button type="submit" disabled={disabled || invitePending}>
                  {invitePending ? "Sending…" : "Send invitation"}
                </Button>
                {inviteState?.ok && <span className="text-sm text-emerald-600">Invitation sent.</span>}
                {inviteState?.error && <span className="text-sm text-red-600">{inviteState.error}</span>}
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
