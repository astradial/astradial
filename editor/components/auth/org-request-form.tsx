"use client";

import { useState } from "react";
import AstradialLogo from "@/components/icons/AstradialLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function OrgRequestForm({ initialEmail, onBack }: { initialEmail: string, onBack: () => void }) {
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [orgReq, setOrgReq] = useState({ name: "", phone: "", address: "", industry: "", company_size: "", expected_users: "", description: "" });

  async function handleOrgRequest() {
    if (!orgReq.name.trim()) { setError("Organisation name is required"); return; }
    if (!orgReq.phone.trim()) { setError("Phone number is required"); return; }
    if (!orgReq.industry) { setError("Please select your industry"); return; }
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/pbx/auth/request-org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: initialEmail,
          org_name: orgReq.name,
          contact_email: initialEmail,
          contact_phone: orgReq.phone,
          industry: orgReq.industry,
          address: orgReq.address,
          company_size: orgReq.company_size,
          expected_users: orgReq.expected_users,
          description: orgReq.description,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Request failed"); setLoading(false); return; }
      setSuccess("Organisation requested! Admin will review and approve shortly. You'll be able to log in once approved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Request failed"); }
    finally { setLoading(false); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background w-full">
      <div className="w-full max-w-lg space-y-6 p-8">
        <div className="text-center space-y-2">
          <AstradialLogo height={32} color="currentColor" className="mx-auto" />
          <h1 className="text-2xl font-semibold">Set Up Your Organisation</h1>
          <p className="text-sm text-muted-foreground">Tell us about your business to get started</p>
        </div>
        {error && <p className="text-sm text-destructive text-center">{error}</p>}
        {success && <p className="text-sm text-green-600 dark:text-green-400 text-center">{success}</p>}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Organisation Name *</Label>
              <Input value={orgReq.name} onChange={e => setOrgReq({ ...orgReq, name: e.target.value })} placeholder="Acme Corp" />
            </div>
            <div className="space-y-1.5">
              <Label>Phone *</Label>
              <Input value={orgReq.phone} onChange={e => setOrgReq({ ...orgReq, phone: e.target.value })} placeholder="+91 98765 43210" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input value={initialEmail} disabled />
          </div>
          <div className="space-y-1.5">
            <Label>Address</Label>
            <Input value={orgReq.address} onChange={e => setOrgReq({ ...orgReq, address: e.target.value })} placeholder="City, State" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Industry *</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={orgReq.industry} onChange={e => setOrgReq({ ...orgReq, industry: e.target.value })}>
                <option value="">Select industry</option>
                <option value="Healthcare">Healthcare</option>
                <option value="Hospitality">Hospitality</option>
                <option value="Technology">Technology</option>
                <option value="Real Estate">Real Estate</option>
                <option value="Education">Education</option>
                <option value="Financial Services">Financial Services</option>
                <option value="Retail">Retail</option>
                <option value="Manufacturing">Manufacturing</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Company Size</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={orgReq.company_size} onChange={e => setOrgReq({ ...orgReq, company_size: e.target.value })}>
                <option value="">Select size</option>
                <option value="1-10">1-10 employees</option>
                <option value="11-50">11-50 employees</option>
                <option value="51-200">51-200 employees</option>
                <option value="201-500">201-500 employees</option>
                <option value="500+">500+ employees</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Expected Users (how many people will use the phone system)</Label>
            <Input value={orgReq.expected_users} onChange={e => setOrgReq({ ...orgReq, expected_users: e.target.value })} placeholder="e.g. 5, 20, 50" />
          </div>
          <div className="space-y-1.5">
            <Label>Tell us what you need</Label>
            <textarea className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground" value={orgReq.description} onChange={e => setOrgReq({ ...orgReq, description: e.target.value })} placeholder="e.g. We need a phone system for our hotel front desk with 3 lines and call recording..." />
          </div>
          <Button className="w-full" onClick={handleOrgRequest} disabled={loading}>
            {loading ? "Submitting..." : "Submit Application"}
          </Button>
          <Button variant="ghost" className="w-full" onClick={onBack}>Back to Sign In</Button>
        </div>
      </div>
    </div>
  );
}
