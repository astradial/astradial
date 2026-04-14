"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Building2, Phone, Users, Shield, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { showToast } from "@/components/ui/Toast";
import { INDUSTRY_PRESETS } from "@/lib/admin/client";

const STEPS = [
  { label: "Organisation", icon: Building2 },
  { label: "Limits", icon: Shield },
  { label: "Review & Create", icon: Rocket },
];

export default function CreateOrgPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Record<string, string> | null>(null);

  // Step 1: Org details
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("hotel");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  // Step 2: Limits
  const [maxUsers, setMaxUsers] = useState(50);
  const [maxDids, setMaxDids] = useState(10);
  const [maxTrunks, setMaxTrunks] = useState(5);
  const [maxQueues, setMaxQueues] = useState(10);
  const [concurrentCalls, setConcurrentCalls] = useState(30);

  // Compliance (initialized from industry preset, user can override)
  const [consentMode, setConsentMode] = useState(INDUSTRY_PRESETS.hotel.recording_consent);
  const [retentionCdr, setRetentionCdr] = useState(INDUSTRY_PRESETS.hotel.retention_cdr_days);
  const [retentionRecording, setRetentionRecording] = useState(INDUSTRY_PRESETS.hotel.retention_recording_days);
  const [piiMasking, setPiiMasking] = useState(INDUSTRY_PRESETS.hotel.pii_masking);

  // Auto-apply preset when industry changes
  function applyPreset(ind: string) {
    const p = INDUSTRY_PRESETS[ind] || INDUSTRY_PRESETS.general;
    setConsentMode(p.recording_consent);
    setRetentionCdr(p.retention_cdr_days);
    setRetentionRecording(p.retention_recording_days);
    setPiiMasking(p.pii_masking);
  }

  const compliance = { recording_consent: consentMode, retention_cdr_days: retentionCdr, retention_recording_days: retentionRecording, pii_masking: piiMasking };

  async function handleCreate() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/create-org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          contact_info: { email, phone },
          settings: {
            max_users: maxUsers,
            max_dids: maxDids,
            max_trunks: maxTrunks,
            max_queues: maxQueues,
            recording_enabled: true,
            features: { call_transfer: true, call_recording: true, voicemail: true, conference: true, ivr: true, ai_agent: true },
          },
          limits: { concurrent_calls: concurrentCalls, monthly_minutes: 50000, storage_gb: 50 },
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        if (res.status === 409) throw new Error("Organisation name already exists. Choose a different name.");
        throw new Error(err.error || err.message || "Creation failed");
      }

      const data = await res.json();
      setResult({
        id: data.id,
        name: data.name,
        api_key: data.api_key,
        api_secret: data.api_secret,
        context_prefix: data.context_prefix,
      });

      // Auto-create compliance settings
      try {
        await fetch(`/api/pbx/compliance?org_id=${data.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-Internal-Key": "" },
          body: JSON.stringify(compliance),
        });
      } catch {}

      showToast(`Organisation "${name}" created!`, "success");
      setStep(3); // success step
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setLoading(false);
    }
  }

  // Success page
  if (step === 3 && result) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-accent mb-3">
            <Check className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-semibold">Organisation Created</h1>
          <p className="text-sm text-muted-foreground">Save the API credentials below — the secret is shown only once</p>
        </div>
        <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
          <div className="flex justify-between"><span className="text-sm text-muted-foreground">Name</span><span className="text-sm font-medium">{result.name}</span></div>
          <Separator />
          <div className="flex justify-between"><span className="text-sm text-muted-foreground">Org ID</span><span className="text-sm font-mono">{result.id}</span></div>
          <Separator />
          <div className="flex justify-between"><span className="text-sm text-muted-foreground">API Key</span><span className="text-sm font-mono">{result.api_key}</span></div>
          <Separator />
          <div className="flex justify-between items-start">
            <span className="text-sm text-muted-foreground">API Secret</span>
            <div className="text-right">
              <span className="text-sm font-mono text-destructive">{result.api_secret}</span>
              <p className="text-[10px] text-muted-foreground mt-0.5">Save this now — it won&apos;t be shown again</p>
            </div>
          </div>
          <Separator />
          <div className="flex justify-between"><span className="text-sm text-muted-foreground">Context Prefix</span><span className="text-sm font-mono">{result.context_prefix}</span></div>
          <Separator />
          <div className="flex justify-between"><span className="text-sm text-muted-foreground">Industry</span><span className="text-sm">{industry}</span></div>
          <div className="flex justify-between"><span className="text-sm text-muted-foreground">Recording retention</span><span className="text-sm">{compliance.retention_recording_days} days</span></div>
          <div className="flex justify-between"><span className="text-sm text-muted-foreground">CDR retention</span><span className="text-sm">{compliance.retention_cdr_days} days</span></div>
        </div>
        <div className="flex gap-2 mt-6">
          <Button variant="outline" onClick={() => router.push("/admin/organizations")}>Back to list</Button>
          <Button onClick={() => router.push(`/dashboard/${result.id}`)}>Open Dashboard</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Header */}
      <Button variant="ghost" size="sm" className="mb-4" onClick={() => router.push("/admin/organizations")}>
        <ArrowLeft className="h-4 w-4 mr-1" />Back
      </Button>
      <h1 className="text-lg font-semibold mb-1">Create Organisation</h1>
      <p className="text-sm text-muted-foreground mb-6">Onboard a new client</p>

      {/* Step indicators */}
      <div className="flex items-center gap-2 mb-8">
        {STEPS.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className={`flex items-center justify-center h-8 w-8 rounded-full text-xs font-medium ${i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}`}>
              {i < step ? <Check className="h-4 w-4" /> : i + 1}
            </div>
            <span className={`text-sm hidden sm:inline ${i === step ? "font-medium" : "text-muted-foreground"}`}>{s.label}</span>
            {i < STEPS.length - 1 && <div className="w-8 h-px bg-border" />}
          </div>
        ))}
      </div>

      {/* Step 1: Org details */}
      {step === 0 && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Organisation Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Grand Estancia Salem" />
            <p className="text-xs text-muted-foreground">3-50 characters, letters/numbers/hyphens only</p>
          </div>
          <div className="space-y-2">
            <Label>Industry *</Label>
            <Select value={industry} onValueChange={(v) => { setIndustry(v); applyPreset(v); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hotel">Hotel / Hospitality</SelectItem>
                <SelectItem value="hospital">Hospital / Healthcare</SelectItem>
                <SelectItem value="general">General Business</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Auto-sets compliance: {industry === "hospital" ? "3-year retention, explicit consent, PII masking ON" : industry === "hotel" ? "6-month recording retention, announcement consent" : "12-month retention, announcement consent"}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Contact Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@hotel.com" />
            </div>
            <div className="space-y-2">
              <Label>Contact Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 99444 21125" />
            </div>
          </div>
          <div className="flex justify-end pt-4">
            <Button onClick={() => setStep(1)} disabled={!name || name.length < 3}>
              Next <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Limits */}
      {step === 1 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Set resource limits for this organisation. Can be changed later.</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Max Users (SIP extensions)</Label>
              <Input type="number" value={maxUsers} onChange={(e) => setMaxUsers(+e.target.value)} min={1} max={500} />
            </div>
            <div className="space-y-2">
              <Label>Max DIDs (phone numbers)</Label>
              <Input type="number" value={maxDids} onChange={(e) => setMaxDids(+e.target.value)} min={1} max={100} />
            </div>
            <div className="space-y-2">
              <Label>Max Trunks (SIP connections)</Label>
              <Input type="number" value={maxTrunks} onChange={(e) => setMaxTrunks(+e.target.value)} min={1} max={20} />
            </div>
            <div className="space-y-2">
              <Label>Max Queues</Label>
              <Input type="number" value={maxQueues} onChange={(e) => setMaxQueues(+e.target.value)} min={1} max={50} />
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Concurrent Call Limit</Label>
              <Input type="number" value={concurrentCalls} onChange={(e) => setConcurrentCalls(+e.target.value)} min={5} max={500} />
              <p className="text-xs text-muted-foreground">Maximum simultaneous calls across all DIDs/extensions</p>
            </div>
          </div>

          <Separator />
          <h3 className="text-sm font-medium">Compliance & Data Retention</h3>
          <p className="text-xs text-muted-foreground">Pre-filled from {industry} preset. Edit as needed.</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Recording Consent Mode</Label>
              <Select value={consentMode} onValueChange={setConsentMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="announcement">Announcement (play notice, record automatically)</SelectItem>
                  <SelectItem value="external_consent">External Consent (form/app/check-in, no in-call notice)</SelectItem>
                  <SelectItem value="opt_out">Opt-Out (record by default, caller presses 2 to stop)</SelectItem>
                  <SelectItem value="explicit_opt_in">Explicit Opt-In (caller must press 1 to allow recording)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>CDR Retention (days)</Label>
              <Input type="number" value={retentionCdr} onChange={(e) => setRetentionCdr(+e.target.value)} min={30} max={3650} />
              <p className="text-xs text-muted-foreground">{Math.round(retentionCdr / 30)} months</p>
            </div>
            <div className="space-y-2">
              <Label>Recording Retention (days)</Label>
              <Input type="number" value={retentionRecording} onChange={(e) => setRetentionRecording(+e.target.value)} min={30} max={3650} />
              <p className="text-xs text-muted-foreground">{Math.round(retentionRecording / 30)} months</p>
            </div>
            <div className="space-y-2">
              <Label>PII Masking (agents see masked phone numbers)</Label>
              <div className="flex items-center gap-2 pt-1">
                <Switch checked={piiMasking} onCheckedChange={setPiiMasking} />
                <span className="text-sm text-muted-foreground">{piiMasking ? "Enabled" : "Disabled"}</span>
              </div>
            </div>
          </div>

          <div className="flex justify-between pt-4">
            <Button variant="outline" onClick={() => setStep(0)}>
              <ArrowLeft className="h-4 w-4 mr-1" />Back
            </Button>
            <Button onClick={() => setStep(2)}>
              Next <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Review & Create */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="border rounded-lg p-4 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Name</span><span className="font-medium">{name}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Industry</span><span>{industry}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Contact</span><span>{email || "—"} / {phone || "—"}</span></div>
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">Users</span><span>{maxUsers}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">DIDs</span><span>{maxDids}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Trunks</span><span>{maxTrunks}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Queues</span><span>{maxQueues}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Concurrent calls</span><span>{concurrentCalls}</span></div>
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">Recording consent</span><span>{compliance.recording_consent.replace("_", " ")}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">CDR retention</span><span>{compliance.retention_cdr_days} days</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Recording retention</span><span>{compliance.retention_recording_days} days</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">PII masking</span><span>{compliance.pii_masking ? "Yes" : "No"}</span></div>
          </div>

          <div className="flex justify-between pt-4">
            <Button variant="outline" onClick={() => setStep(1)}>
              <ArrowLeft className="h-4 w-4 mr-1" />Back
            </Button>
            <Button onClick={handleCreate} disabled={loading}>
              {loading ? "Creating..." : "Create Organisation"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
