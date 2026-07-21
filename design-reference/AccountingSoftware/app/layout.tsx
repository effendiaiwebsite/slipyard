import "./globals.css";
import type { Metadata } from "next";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";

export const metadata: Metadata = {
  title: "Lakeside CPA — Practice Suite",
  description: "Mock of an AI-augmented practice management suite for Canadian accountants",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="flex">
          <Sidebar />
          <div className="flex-1 min-w-0">
            <Topbar />
            <main className="min-h-[calc(100vh-3.5rem)]">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
