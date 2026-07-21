import { Sidebar } from "@/components/staff/sidebar";
import { Topbar } from "@/components/staff/topbar";
import { requireStaff } from "@/lib/context";

const roleLabels: Record<string, string> = {
  owner: "Owner",
  admin: "Administrator",
  accountant: "Accountant",
  clerk: "Clerk",
};

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  // The gate: session + mandatory MFA + idle timeout + org membership.
  const ctx = await requireStaff();

  return (
    <div className="flex min-h-screen w-full">
      <Sidebar orgName={ctx.orgName} userName={ctx.user.name} roleLabel={roleLabels[ctx.role]} />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
