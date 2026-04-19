"use client";

import { useState, useEffect } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { OrgRequestForm } from "@/components/auth/org-request-form";
import { AdminOrgList } from "@/components/auth/admin-org-list";
import { getAdminKey } from "@/lib/gateway/client";
import { setOrgToken } from "@/lib/pbx/client";

export default function DashboardPage() {
  const [view, setView] = useState<"login" | "org-request" | "admin">("login");
  const [orgRequestEmail, setOrgRequestEmail] = useState("");

  useEffect(() => {
    // Check admin session
    if (getAdminKey()) {
      setView("admin");
      return;
    }

    // Check shared local storage
    const savedOrg = typeof window !== "undefined" ? localStorage.getItem("org_access") : null;
    if (savedOrg) {
      try {
        const parsed = JSON.parse(savedOrg);
        if (parsed?.org_id && parsed?.api_key) {
          setOrgToken(parsed.api_key);
          window.location.href = `/dashboard/${parsed.org_id}`;
        }
      } catch (e) {
        console.error("Local org_access error", e);
      }
    }
  }, []);

  const handleUserAuthenticated = (data: { org_id: string; api_key: string }) => {
    setOrgToken(data.api_key);
    window.location.href = `/dashboard/${data.org_id}`;
  };

  if (view === "org-request") {
    return <OrgRequestForm initialEmail={orgRequestEmail} onBack={() => setView("login")} />;
  }

  if (view === "admin") {
    return <AdminOrgList onLogout={() => setView("login")} />;
  }

  return (
    <LoginForm
      onAdminAuthenticated={() => setView("admin")}
      onUserAuthenticated={handleUserAuthenticated}
      onRequireOrgSetup={(email) => {
        setOrgRequestEmail(email);
        setView("org-request");
      }}
    />
  );
}
