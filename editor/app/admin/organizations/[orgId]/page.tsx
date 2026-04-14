"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Save, Key, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { showToast } from "@/components/ui/Toast";
import { adminOrgs } from "@/lib/admin/client";

export default function OrgDetailPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [org, setOrg] = useState<Record<string, unknown> | null>(null);
  const [compliance, setCompliance] = useState<Record<string, unknown> | null>(null);
  const [creds, setCreds] = useState<{ api_key: string; api_secret_plaintext: string } | null>(null);

  // Editable fields
  const [name, setName] = useState("");
  const [status, setStatus] = useState("active");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [maxUsers, setMaxUsers] = useState(50);
  const [maxDids, setMaxDids] = useState(10);
  const [maxTrunks, setMaxTrunks] = useState(5);
  const [maxQueues, setMaxQueues] = useState(10);
  const [concurrentCalls, setConcurrentCalls] = useState(30);
  const [monthlyMinutes, setMonthlyMinutes] = useState(10000);
  const [storageGb, setStorageGb] = useState(10);

  // Features
  const [recordingEnabled, setRecordingEnabled] = useState(false);
  const [webhookEnabled, setWebhookEnabled] = useState(true);
  const [callTransfer, setCallTransfer] = useState(true);
  const [callRecording, setCallRecording] = useState(true);
  const [voicemail, setVoicemail] = useState(true);
  const [conference, setConference] = useState(true);
  const [ivr, setIvr] = useState(true);
  const [aiAgent, setAiAgent] = useState(false);

  // Compliance
  const [consentMode, setConsentMode] = useState("announcement");
  const [retentionCdr, setRetentionCdr] = useState(365);
  const [retentionRecording, setRetentionRecording] = useState(180);
  const [piiMasking, setPiiMasking] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/org/${orgId}`);
      if (!res.ok) throw new Error("Failed to load org");
      const { org: data, compliance: compData } = await res.json();

      setOrg(data);
      setName(String(data.name || ""));
      setStatus(String(data.status || "active"));
      const contact = (data.contact_info || {}) as Record<string, string>;
      setEmail(contact.email || "");
      setPhone(contact.phone || "");
      const settings = (data.settings || {}) as Record<string, unknown>;
      setMaxUsers(Number(settings.max_users) || 50);
      setMaxDids(Number(settings.max_dids) || 10);
      setMaxTrunks(Number(settings.max_trunks) || 5);
      setMaxQueues(Number(settings.max_queues) || 10);
      setRecordingEnabled(Boolean(settings.recording_enabled));
      setWebhookEnabled(settings.webhook_enabled !== false);
      const features = (settings.features || {}) as Record<string, boolean>;
      setCallTransfer(features.call_transfer !== false);
      setCallRecording(features.call_recording !== false);
      setVoicemail(features.voicemail !== false);
      setConference(features.conference !== false);
      setIvr(features.ivr !== false);
      setAiAgent(Boolean(features.ai_agent));
      const limits = (data.limits || {}) as Record<string, number>;
      setConcurrentCalls(limits.concurrent_calls || 30);
      setMonthlyMinutes(limits.monthly_minutes || 10000);
      setStorageGb(limits.storage_gb || 10);

      if (compData) {
        setCompliance(compData);
        setConsentMode(String(compData.recording_consent || "announcement"));
        setRetentionCdr(Number(compData.retention_cdr_days) || 365);
        setRetentionRecording(Number(compData.retention_recording_days) || 180);
        setPiiMasking(Boolean(compData.pii_masking));
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Load failed", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [orgId]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/org/${orgId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          status,
          contact_info: { email, phone },
          settings: {
            max_users: maxUsers, max_dids: maxDids, max_trunks: maxTrunks, max_queues: maxQueues,
            recording_enabled: recordingEnabled, webhook_enabled: webhookEnabled,
            features: { call_transfer: callTransfer, call_recording: callRecording, voicemail, conference, ivr, ai_agent: aiAgent },
          },
          limits: { concurrent_calls: concurrentCalls, monthly_minutes: monthlyMinutes, storage_gb: storageGb },
          compliance: {
            recording_consent: consentMode,
            retention_cdr_days: retentionCdr,
            retention_recording_days: retentionRecording,
            pii_masking: piiMasking,
          },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error || "Save failed");
      }
      showToast("Organisation updated", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleRotateSecret() {
    if (!confirm("This will generate a new API secret. The old one will stop working immediately. Continue?")) return;
    try {
      const data = await adminOrgs.getCredentials(orgId);
      setCreds(data);
      showToast("New API secret generated — save it now", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "error");
    }
  }

  if (loading) {
    return <div className="p-6"><p className="text-sm text-muted-foreground">Loading...</p></div>;
  }

  return (
    <div className="p-6 max-w-3xl">
      <Button variant="ghost" size="sm" className="mb-4" onClick={() => router.push("/admin/organizations")}>
        <ArrowLeft className="h-4 w-4 mr-1" />Back
      </Button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold">{org?.name as string}</h1>
          <p className="text-sm text-muted-foreground font-mono">{orgId}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => router.push(`/dashboard/${orgId}`)}>Open Dashboard</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-1" />{saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        {/* General */}
        <section className="border rounded-lg p-4 space-y-4">
          <h2 className="text-sm font-semibold">General</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Contact Email</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Contact Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-muted-foreground">Context Prefix:</span> <span className="font-mono">{org?.context_prefix as string}</span></div>
            <div><span className="text-muted-foreground">API Key:</span> <span className="font-mono text-xs">{org?.api_key as string}</span></div>
          </div>
        </section>

        {/* API Credentials */}
        <section className="border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">API Credentials</h2>
            <Button variant="outline" size="sm" onClick={handleRotateSecret}>
              <Key className="h-4 w-4 mr-1" />Rotate Secret
            </Button>
          </div>
          {creds && (
            <div className="bg-muted/30 rounded-md p-3 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">API Key</span><span className="font-mono">{creds.api_key}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">New Secret</span><span className="font-mono text-destructive">{creds.api_secret_plaintext}</span></div>
              <p className="text-xs text-muted-foreground">Save this now — it won&apos;t be shown again after you leave this page.</p>
            </div>
          )}
        </section>

        {/* Features */}
        <section className="border rounded-lg p-4 space-y-4">
          <h2 className="text-sm font-semibold">Features</h2>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Recording Enabled", value: recordingEnabled, set: setRecordingEnabled },
              { label: "Webhooks Enabled", value: webhookEnabled, set: setWebhookEnabled },
              { label: "Call Transfer", value: callTransfer, set: setCallTransfer },
              { label: "Call Recording", value: callRecording, set: setCallRecording },
              { label: "Voicemail", value: voicemail, set: setVoicemail },
              { label: "Conference", value: conference, set: setConference },
              { label: "IVR", value: ivr, set: setIvr },
              { label: "AI Agent", value: aiAgent, set: setAiAgent },
            ].map(({ label, value, set }) => (
              <div key={label} className="flex items-center justify-between border rounded-md p-2.5">
                <Label className="text-sm">{label}</Label>
                <Switch checked={value} onCheckedChange={set} />
              </div>
            ))}
          </div>
        </section>

        {/* Limits */}
        <section className="border rounded-lg p-4 space-y-4">
          <h2 className="text-sm font-semibold">Resource Limits</h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Max Users</Label>
              <Input type="number" value={maxUsers} onChange={(e) => setMaxUsers(+e.target.value)} min={1} max={500} />
            </div>
            <div className="space-y-2">
              <Label>Max DIDs</Label>
              <Input type="number" value={maxDids} onChange={(e) => setMaxDids(+e.target.value)} min={1} max={100} />
            </div>
            <div className="space-y-2">
              <Label>Max Trunks</Label>
              <Input type="number" value={maxTrunks} onChange={(e) => setMaxTrunks(+e.target.value)} min={1} max={20} />
            </div>
            <div className="space-y-2">
              <Label>Max Queues</Label>
              <Input type="number" value={maxQueues} onChange={(e) => setMaxQueues(+e.target.value)} min={1} max={50} />
            </div>
            <div className="space-y-2">
              <Label>Concurrent Calls</Label>
              <Input type="number" value={concurrentCalls} onChange={(e) => setConcurrentCalls(+e.target.value)} min={5} max={500} />
            </div>
            <div className="space-y-2">
              <Label>Monthly Minutes</Label>
              <Input type="number" value={monthlyMinutes} onChange={(e) => setMonthlyMinutes(+e.target.value)} min={100} max={1000000} />
            </div>
            <div className="space-y-2">
              <Label>Storage (GB)</Label>
              <Input type="number" value={storageGb} onChange={(e) => setStorageGb(+e.target.value)} min={1} max={1000} />
            </div>
          </div>
        </section>

        {/* Compliance */}
        <section className="border rounded-lg p-4 space-y-4">
          <h2 className="text-sm font-semibold">Compliance & Data Retention</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Recording Consent Mode</Label>
              <Select value={consentMode} onValueChange={setConsentMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="announcement">Announcement (play notice, record automatically)</SelectItem>
                  <SelectItem value="external_consent">External Consent (no in-call notice)</SelectItem>
                  <SelectItem value="opt_out">Opt-Out (record by default, press 2 to stop)</SelectItem>
                  <SelectItem value="explicit_opt_in">Explicit Opt-In (press 1 to allow recording)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>CDR Retention</Label>
              <Input type="number" value={retentionCdr} onChange={(e) => setRetentionCdr(+e.target.value)} min={30} max={3650} />
              <p className="text-xs text-muted-foreground">{Math.round(retentionCdr / 30)} months</p>
            </div>
            <div className="space-y-2">
              <Label>Recording Retention</Label>
              <Input type="number" value={retentionRecording} onChange={(e) => setRetentionRecording(+e.target.value)} min={30} max={3650} />
              <p className="text-xs text-muted-foreground">{Math.round(retentionRecording / 30)} months</p>
            </div>
            <div className="space-y-2">
              <Label>PII Masking</Label>
              <div className="flex items-center gap-2 pt-1">
                <Switch checked={piiMasking} onCheckedChange={setPiiMasking} />
                <span className="text-sm text-muted-foreground">{piiMasking ? "Enabled" : "Disabled"}</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
