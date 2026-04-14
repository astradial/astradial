"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import AstradialLogo from "@/components/icons/AstradialLogo";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2">
            <AstradialLogo height={18} color="currentColor" />
            <h1 className="text-lg font-semibold">Astradial</h1>
            <span className="text-xs text-muted-foreground ml-1">Admin</span>
          </div>
          <Link href="/dashboard">
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Back to Dashboard</Button>
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl">{children}</main>
    </div>
  );
}
