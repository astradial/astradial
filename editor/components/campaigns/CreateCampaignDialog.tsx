"use client";

import { Check, CheckCircle, ChevronLeft, ChevronRight, Play, Upload, X } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ImportProgress } from "@/components/campaigns/ImportProgress";
import { showToast } from "@/components/ui/Toast";
import { campaigns, imports, templates } from "@/lib/campaigns/client";
import type { CampaignImportJob, CampaignTemplate } from "@/lib/campaigns/types";

// Built from Astra Campaign-handoff/app/screens/campaigns.jsx#CreateCampaignModal.
// Replaces the prior shadcn-Dialog-based wizard. Pure HTML/CSS using
// the .cmp-modal-* design tokens.

type StepNum = 1 | 2 | 3 | 4;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (campaignId: string) => void;
}

interface OrgUser {
  id: string;
  full_name: string | null;
  username: string;
  email: string;
}

async function fetchOrgUsers(): Promise<OrgUser[]> {
  const token = typeof window !== "undefined" ? localStorage.getItem("pbx_org_token") || "" : "";
  const apiKey = typeof window !== "undefined" ? localStorage.getItem("pbx_api_key") || "" : "";
  const h: HeadersInit = {};
  if (token) h["Authorization"] = `Bearer ${token}`;
  else if (apiKey) h["X-API-Key"] = apiKey;
  const res = await fetch("/api/pbx/users", { headers: h });
  if (!res.ok) throw new Error(`Failed to load users (${res.status})`);
  return res.json();
}

const STEPS: { n: StepNum; label: string }[] = [
  { n: 1, label: "Name" },
  { n: 2, label: "Upload leads" },
  { n: 3, label: "Pick template" },
  { n: 4, label: "Schedule" },
];

const SYSTEM_FIELD_OPTIONS: { id: string; label: string }[] = [
  { id: "name", label: "name" },
  { id: "phone", label: "phone" },
  { id: "country", label: "country" },
  { id: "business", label: "business" },
  { id: "status", label: "status" },
  { id: "lastTouch", label: "lastTouch" },
];

// Lightweight first-line CSV header parser. Server-side papaparse does
// the heavy lifting; this only feeds the column-mapping table.
function parseCsvHeaders(text: string): string[] {
  const firstLine = (text.split(/\r?\n/, 1)[0] || "").replace(/^\uFEFF/, "");
  if (!firstLine) return [];
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < firstLine.length; i++) {
    const c = firstLine[i];
    if (q) {
      if (c === '"' && firstLine[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (c === '"') {
        q = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      q = true;
    } else if (c === ",") {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out.filter((h) => h.length > 0);
}

function suggestMapping(headers: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const h of headers) {
    const low = h.toLowerCase();
    if (/^(phone|mobile|contact|number)/.test(low)) m[h] = "phone";
    else if (/^(name|full[_ ]?name|first[_ ]?name|contact[_ ]?name)/.test(low)) m[h] = "name";
    else if (/^(business|company|organisation|organization)/.test(low)) m[h] = "business";
    else if (/^(country)/.test(low)) m[h] = "country";
    else if (/^(status|stage)/.test(low)) m[h] = "status";
  }
  return m;
}

export function CreateCampaignDialog({ open, onOpenChange, onCreated }: Props) {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();

  const [step, setStep] = useState<StepNum>(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [owner, setOwner] = useState("");
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [publishedTemplates, setPublishedTemplates] = useState<CampaignTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [schedule, setSchedule] = useState<"now" | "scheduled" | "manual">("now");
  const [scheduleDate, setScheduleDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Phase A async import: after step-4 submit we create the campaign,
  // enqueue the import job, then render <ImportProgress/> in-place
  // until the worker reaches a terminal state. The dialog stays open
  // during that window so the user can watch.
  const [importingCampaignId, setImportingCampaignId] = useState<string | null>(null);
  const [importingJobId, setImportingJobId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset + load when opening
  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setStep(1);
    setName("");
    setDescription("");
    setFile(null);
    setHeaders([]);
    setMapping({});
    setPreviewRows([]);
    setTemplateId("");
    setSchedule("now");
    setScheduleDate("");
    setImportingCampaignId(null);
    setImportingJobId(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    templates
      .list({ status: "published", limit: 100 })
      .then((r) => setPublishedTemplates(r.data))
      .catch((e: unknown) => showToast((e as Error).message, "error"));
    fetchOrgUsers()
      .then((users) => {
        setOrgUsers(users);
        // Default to the first active user — usually the calling operator.
        // The backend falls back to req.userId when owner_user_id is empty,
        // so leaving "" is also valid; we just want a visible default.
        if (users.length > 0) setOwner(users[0].id);
      })
      .catch((e: unknown) => showToast((e as Error).message, "error"));
  }, [open]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  async function handleFile(f: File | null) {
    setFile(f);
    setHeaders([]);
    setMapping({});
    setPreviewRows([]);
    if (!f) return;
    const text = await f.text();
    const hs = parseCsvHeaders(text);
    setHeaders(hs);
    setMapping(suggestMapping(hs));
    // Capture a 1-row preview for the right-hand "Sample" column.
    const second = text.split(/\r?\n/, 2)[1] || "";
    if (second) {
      const cols = parseCsvHeaders(second);
      setPreviewRows([cols]);
    }
  }

  const phoneMapped = useMemo(() => Object.values(mapping).includes("phone"), [mapping]);

  const selectedTemplate = useMemo(
    () => publishedTemplates.find((t) => t.id === templateId),
    [publishedTemplates, templateId]
  );

  function canAdvance(): boolean {
    if (step === 1) return name.trim().length > 0;
    if (step === 2) return !!file && phoneMapped;
    if (step === 3) return !!templateId;
    return true;
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const startAt =
        schedule === "scheduled" && scheduleDate ? new Date(scheduleDate).toISOString() : undefined;
      // Step 1: create the campaign WITHOUT the CSV. We route lead
      // ingestion through the async import path (PR-A) so a 5-lakh
      // upload doesn't block the HTTP request.
      const res = await campaigns.create({
        name: name.trim(),
        description: description.trim() || undefined,
        template_id: templateId,
        owner_user_id: owner || undefined,
        start_at: startAt,
      });
      // Step 2: enqueue the CSV import. The dialog switches to the
      // <ImportProgress/> view; onComplete/onFailed wire navigation
      // and (optionally) auto-launch.
      if (file) {
        const imp = await imports.create(res.campaign.id, file, mapping);
        setImportingCampaignId(res.campaign.id);
        setImportingJobId(imp.jobId);
        showToast("Campaign created — importing leads in background", "success");
      } else {
        // No file uploaded (edge case — step 2 normally requires one).
        // Skip the import phase, jump straight to launch/navigate.
        await finalizeAfterImport(res.campaign.id, 0);
      }
    } catch (e: unknown) {
      showToast((e as Error).message, "error");
      setSubmitting(false);
    }
  }

  // Shared finalization — called when the import completes OR when the
  // import is skipped (no file). Auto-launches if the user picked
  // "Start immediately", then closes the dialog and navigates.
  async function finalizeAfterImport(campaignId: string, insertedCount: number) {
    if (schedule === "now") {
      try {
        await campaigns.launch(campaignId);
      } catch {
        // Not fatal — campaign exists as draft; user can launch later.
      }
    }
    if (insertedCount > 0) {
      showToast(`Imported ${insertedCount.toLocaleString("en-US")} leads`, "success");
    }
    onCreated?.(campaignId);
    onOpenChange(false);
    router.push(`/dashboard/${orgId}/campaigns/${campaignId}`);
  }

  function handleImportComplete(job: CampaignImportJob) {
    if (importingCampaignId) {
      finalizeAfterImport(importingCampaignId, job.inserted);
    }
  }

  function handleImportFailed(job: CampaignImportJob) {
    showToast(`Import failed: ${job.last_error || "unknown error"}`, "error");
    // Don't close — let the user read the errors and decide.
    setSubmitting(false);
  }

  // Portal-mount so the modal escapes any transform/scroll container.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
  if (!mounted || !open) return null;

  const selectedTpl = selectedTemplate;

  // Once enqueued, swap the wizard body for the live import-progress
  // view. We keep the modal open until the user dismisses on terminal
  // state (handlers above auto-close on success).
  if (importingCampaignId && importingJobId) {
    const importBody = (
      <div className="cmp-modal-overlay" onClick={() => onOpenChange(false)}>
        <div className="cmp-modal cmp-modal-lg" onClick={(e) => e.stopPropagation()}>
          <div className="cmp-modal-head">
            <div>
              <h2 className="cmp-modal-title">Importing leads</h2>
              <p className="cmp-modal-sub">
                {file?.name || "CSV"} — campaign created, worker is processing in the background
              </p>
            </div>
            <button
              type="button"
              className="cmp-icon-btn"
              aria-label="Close"
              onClick={() => onOpenChange(false)}
            >
              <X size={16} />
            </button>
          </div>
          <div className="cmp-modal-body" style={{ minHeight: 280 }}>
            <ImportProgress
              campaignId={importingCampaignId}
              jobId={importingJobId}
              onComplete={handleImportComplete}
              onFailed={handleImportFailed}
            />
          </div>
          <div className="cmp-modal-foot">
            <button
              type="button"
              className="cmp-btn cmp-btn-ghost cmp-btn-sm"
              onClick={() => {
                // Closing the dialog mid-import doesn't cancel the
                // worker — it keeps running, and the user can watch
                // progress from the campaign detail page.
                onOpenChange(false);
                if (importingCampaignId) {
                  router.push(`/dashboard/${orgId}/campaigns/${importingCampaignId}`);
                }
              }}
            >
              Hide &amp; open campaign
            </button>
          </div>
        </div>
      </div>
    );
    return createPortal(importBody, document.body);
  }

  const body = (
    <div className="cmp-modal-overlay" onClick={() => onOpenChange(false)}>
      <div className="cmp-modal cmp-modal-lg" onClick={(e) => e.stopPropagation()}>
        {/* Head */}
        <div className="cmp-modal-head">
          <div>
            <h2 className="cmp-modal-title">Create campaign</h2>
            <p className="cmp-modal-sub">Bind leads to a Studio template and run outreach</p>
          </div>
          <button
            type="button"
            className="cmp-icon-btn"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
          >
            <X size={16} />
          </button>
        </div>

        {/* Step indicator */}
        <div style={{ padding: "16px 24px 0" }}>
          <div className="cmp-wizard-steps">
            {STEPS.map((s, i) => (
              <React.Fragment key={s.n}>
                <div
                  className={`cmp-wizard-step ${
                    step === s.n ? "cmp-wizard-active" : step > s.n ? "cmp-wizard-done" : ""
                  }`}
                >
                  <span className="cmp-step-num">{step > s.n ? <Check size={11} /> : s.n}</span>
                  <span>{s.label}</span>
                </div>
                {i < STEPS.length - 1 && <div className="cmp-wizard-sep" />}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="cmp-modal-body" style={{ minHeight: 360 }}>
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <div>
                <label className="cmp-label" htmlFor="c-name">
                  Campaign name
                </label>
                <input
                  id="c-name"
                  className="cmp-input"
                  placeholder="e.g. Q2 Jaipur boutique hotels"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <label className="cmp-label" htmlFor="c-desc">
                  Description (optional)
                </label>
                <textarea
                  id="c-desc"
                  className="cmp-input"
                  rows={3}
                  placeholder="Internal notes for your team"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div>
                <label className="cmp-label" htmlFor="c-owner">
                  Owner
                </label>
                <select
                  id="c-owner"
                  className="cmp-input w-full"
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                >
                  <option value="" disabled style={{ display: orgUsers.length === 0 ? "block" : "none" }}>
                    Loading…
                  </option>
                  {orgUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name || u.username || u.email}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-4">
              <div className="text-[13px] text-muted-foreground">
                Upload a CSV with the leads to outreach in this campaign. Each campaign uses its own
                list — leads aren&apos;t shared across campaigns.
              </div>

              {!file ? (
                <div
                  className="cmp-csv-drop"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files?.[0];
                    if (f) handleFile(f);
                  }}
                >
                  <Upload size={32} style={{ color: "var(--muted-foreground)" }} />
                  <div className="font-medium mt-2">Drag a CSV here, or click to browse</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Required columns: <span className="cmp-mono">name</span>,{" "}
                    <span className="cmp-mono">phone</span>. Recommended:{" "}
                    <span className="cmp-mono">business</span>,{" "}
                    <span className="cmp-mono">country</span>.
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => handleFile(e.target.files?.[0] || null)}
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="cmp-csv-uploaded">
                    <span className="cmp-icon-tile cmp-icon-tile-success">
                      <CheckCircle size={16} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{file.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {headers.length} column{headers.length === 1 ? "" : "s"} detected
                        {phoneMapped ? "" : " — map one to phone to continue"}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="cmp-icon-btn"
                      onClick={() => handleFile(null)}
                      aria-label="Remove file"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  {headers.length > 0 && (
                    <div>
                      <label className="cmp-label">Column mapping</label>
                      <table className="cmp-map-table">
                        <thead>
                          <tr>
                            <th>CSV column</th>
                            <th>Maps to</th>
                            <th>Sample</th>
                          </tr>
                        </thead>
                        <tbody>
                          {headers.map((h, idx) => (
                            <tr key={h}>
                              <td className="cmp-mono">{h}</td>
                              <td>
                                <select
                                  className="cmp-input"
                                  style={{ height: 30 }}
                                  value={mapping[h] || "__skip"}
                                  onChange={(e) =>
                                    setMapping((m) => ({
                                      ...m,
                                      [h]: e.target.value === "__skip" ? "" : e.target.value,
                                    }))
                                  }
                                >
                                  <option value="__skip">(skip)</option>
                                  {SYSTEM_FIELD_OPTIONS.map((o) => (
                                    <option key={o.id} value={o.id}>
                                      {o.label}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="text-[13px] text-muted-foreground">
                                {previewRows[0]?.[idx] || "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-3">
              <div className="text-[13px] text-muted-foreground">
                Pick a published template. You can override parameters in the next step.
              </div>
              {publishedTemplates.length === 0 ? (
                <div className="text-[13px] text-muted-foreground p-3 border rounded-lg">
                  No published templates yet. Go to{" "}
                  <a
                    href={`/dashboard/${orgId}/campaigns/studio`}
                    className="underline text-primary"
                  >
                    Studio
                  </a>{" "}
                  and publish one first.
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {publishedTemplates.map((t) => {
                    const days = Array.isArray(t.workflow?.days) ? t.workflow.days.length : 0;
                    const selected = templateId === t.id;
                    return (
                      <button
                        type="button"
                        key={t.id}
                        className={`cmp-pick-card ${selected ? "cmp-pick-selected" : ""}`}
                        onClick={() => setTemplateId(t.id)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium">{t.name}</div>
                            {t.description && (
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {t.description}
                              </div>
                            )}
                            <div className="flex items-center gap-3 mt-2">
                              <span className="cmp-chip">v{t.version}</span>
                              <span className="text-xs text-muted-foreground">{days} days</span>
                            </div>
                          </div>
                          <span className={`cmp-chk ${selected ? "cmp-chk-on" : ""}`}>
                            {selected && <Check size={12} />}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="flex flex-col gap-4">
              <div>
                <label className="cmp-label">When to start</label>
                <div className="flex flex-col gap-3 mt-1">
                  {[
                    {
                      id: "now" as const,
                      label: "Start immediately",
                      sub: "First touches go out within 5 minutes",
                    },
                    {
                      id: "scheduled" as const,
                      label: "Schedule for later",
                      sub: "Pick a date and time",
                    },
                    {
                      id: "manual" as const,
                      label: "Save as draft",
                      sub: "Launch from the dashboard later",
                    },
                  ].map((opt) => {
                    const selected = schedule === opt.id;
                    return (
                      <button
                        type="button"
                        key={opt.id}
                        className={`cmp-pick-card ${selected ? "cmp-pick-selected" : ""}`}
                        style={{ padding: 12 }}
                        onClick={() => setSchedule(opt.id)}
                      >
                        <div className="flex items-center gap-3">
                          <span className={`cmp-chk ${selected ? "cmp-chk-on" : ""}`}>
                            {selected && <Check size={12} />}
                          </span>
                          <div>
                            <div className="font-medium text-[13px]">{opt.label}</div>
                            <div className="text-xs text-muted-foreground">{opt.sub}</div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {schedule === "scheduled" && (
                <div>
                  <label className="cmp-label" htmlFor="c-when">
                    Start date &amp; time
                  </label>
                  <input
                    id="c-when"
                    type="datetime-local"
                    className="cmp-input"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                  />
                </div>
              )}

              <div className="cmp-summary">
                <div className="font-medium text-[13px] mb-1">Summary</div>
                <div className="cmp-summary-row">
                  <span>Name</span>
                  <span>{name || "Untitled campaign"}</span>
                </div>
                <div className="cmp-summary-row">
                  <span>Leads</span>
                  <span>{file?.name || "—"}</span>
                </div>
                <div className="cmp-summary-row">
                  <span>Template</span>
                  <span>{selectedTpl?.name || "—"}</span>
                </div>
                <div className="cmp-summary-row">
                  <span>Start</span>
                  <span>
                    {schedule === "now"
                      ? "Immediately"
                      : schedule === "scheduled"
                        ? scheduleDate
                          ? new Date(scheduleDate).toLocaleString()
                          : "—"
                        : "Manual"}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Foot */}
        <div className="cmp-modal-foot">
          {step > 1 ? (
            <button
              type="button"
              className="cmp-btn cmp-btn-ghost cmp-btn-sm"
              onClick={() => setStep((s) => (s - 1) as StepNum)}
              disabled={submitting}
            >
              <ChevronLeft size={14} /> Back
            </button>
          ) : (
            <button
              type="button"
              className="cmp-btn cmp-btn-ghost cmp-btn-sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </button>
          )}
          <div style={{ flex: 1 }} />
          {step < 4 ? (
            <button
              type="button"
              className="cmp-btn cmp-btn-default cmp-btn-sm"
              disabled={!canAdvance() || submitting}
              onClick={() => setStep((s) => (s + 1) as StepNum)}
            >
              Next <ChevronRight size={14} />
            </button>
          ) : (
            <button
              type="button"
              className="cmp-btn cmp-btn-default cmp-btn-sm"
              disabled={!canAdvance() || submitting}
              onClick={handleSubmit}
            >
              {submitting ? (
                "Creating…"
              ) : schedule === "now" ? (
                <>
                  <Play size={14} /> Launch campaign
                </>
              ) : schedule === "scheduled" ? (
                "Schedule campaign"
              ) : (
                "Save draft"
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}
