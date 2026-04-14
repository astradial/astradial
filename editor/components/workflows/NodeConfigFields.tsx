"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Input that holds local state to prevent focus loss on parent re-renders */
function BufferedInput({ value, onChange, ...props }: { value: string; onChange: (val: string) => void } & Omit<React.ComponentProps<typeof Input>, "onChange" | "value">) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  return (
    <Input
      {...props}
      value={local}
      onChange={(e) => { setLocal(e.target.value); onChange(e.target.value); }}
    />
  );
}

function BufferedTextarea({ value, onChange, ...props }: { value: string; onChange: (val: string) => void } & Omit<React.ComponentProps<typeof Textarea>, "onChange" | "value">) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  return (
    <Textarea
      {...props}
      value={local}
      onChange={(e) => { setLocal(e.target.value); onChange(e.target.value); }}
    />
  );
}

interface BotOption {
  id: string;
  name: string;
  wss_url?: string;
}

interface DidOption {
  number: string;
  description?: string;
}

interface Msg91Number {
  integrated_number?: string;
  number?: string;
}

interface Msg91Template {
  name?: string;
  languages?: { language?: string; status?: string; variables?: string[] }[];
}

interface Props {
  nodeType: string;
  config: Record<string, string>;
  onChange: (key: string, value: string) => void;
  triggerFields?: string[];
  bots?: BotOption[];
  dids?: DidOption[];
  msg91Numbers?: Msg91Number[];
  msg91Templates?: Msg91Template[];
}

function FieldWithTriggerRef({ label, configKey, placeholder, type, config, onChange, triggerFields }: {
  label: string; configKey: string; placeholder: string; type?: string;
  config: Record<string, string>; onChange: (key: string, value: string) => void; triggerFields: string[];
}) {
  const hasTriggerOptions = triggerFields.length > 0 && !["timing", "method", "operator", "priority", "offset_days", "duration"].includes(configKey);
  const currentValue = config[configKey] || "";
  const isUsingTriggerRef = currentValue.startsWith("{trigger.");
  const showManualInput = !isUsingTriggerRef;

  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {hasTriggerOptions ? (
        <>
          <Select
            value={isUsingTriggerRef ? currentValue : "__manual__"}
            onValueChange={(v) => {
              if (v === "__manual__") {
                onChange(configKey, "");
              } else {
                onChange(configKey, v);
              }
            }}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select source..." />
            </SelectTrigger>
            <SelectContent>
              {triggerFields.map((f) => (
                <SelectItem key={f} value={`{trigger.${f}}`}>
                  {`{trigger.${f}}`}
                </SelectItem>
              ))}
              <SelectItem value="__manual__">Enter manually</SelectItem>
            </SelectContent>
          </Select>
          {showManualInput && (
            type === "textarea" ? (
              <BufferedTextarea value={currentValue} onChange={(val) => onChange(configKey, val)} placeholder={placeholder} className="text-xs min-h-[60px] font-mono" />
            ) : (
              <BufferedInput value={currentValue} onChange={(val) => onChange(configKey, val)} placeholder={placeholder} className="h-8 text-xs" />
            )
          )}
        </>
      ) : (
        type === "textarea" ? (
          <BufferedTextarea value={currentValue} onChange={(val) => onChange(configKey, val)} placeholder={placeholder} className="text-xs min-h-[60px] font-mono" />
        ) : type === "date" ? (
          <Input type="date" value={currentValue} onChange={(e) => onChange(configKey, e.target.value)} className="h-8 text-xs" />
        ) : type === "time" ? (
          <Input type="time" value={currentValue} onChange={(e) => onChange(configKey, e.target.value)} className="h-8 text-xs" />
        ) : (
          <BufferedInput value={currentValue} onChange={(val) => onChange(configKey, val)} placeholder={placeholder} className="h-8 text-xs" />
        )
      )}
    </div>
  );
}

export function NodeConfigFields({ nodeType, config, onChange, triggerFields = [], bots = [], dids = [], msg91Numbers = [], msg91Templates = [] }: Props) {
  function DropdownField({ label, configKey, options, placeholder }: { label: string; configKey: string; options: { value: string; label: string }[]; placeholder?: string }) {
    return (
      <div className="space-y-1">
        <Label className="text-xs">{label}</Label>
        <Select value={config[configKey] || ""} onValueChange={(v) => onChange(configKey, v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={placeholder || "Select..."} /></SelectTrigger>
          <SelectContent>
            {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    );
  }

  // Timing section (for actions that can be scheduled)
  function TimingSection() {
    const hasScheduling = ["send_whatsapp", "place_call", "send_email", "http_request", "create_ticket"].includes(nodeType);
    if (!hasScheduling) return null;

    return (
      <>
        <Separator />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Timing</p>
        <DropdownField label="When to run" configKey="timing" options={[
          { value: "immediate", label: "Immediately" },
          { value: "scheduled", label: "Scheduled — at a date/time from data" },
          { value: "recurring", label: "Recurring — loop until date" },
        ]} />
        {config.timing === "scheduled" && (
          <>
            <FieldWithTriggerRef config={config} onChange={onChange} triggerFields={triggerFields} label="Run at date" configKey="run_at_date" placeholder="{trigger.checkin_date}" />
            <FieldWithTriggerRef config={config} onChange={onChange} triggerFields={triggerFields} label="Run at time" configKey="run_at_time" placeholder="{trigger.event_time} or 10:00" />
            <DropdownField label="Offset days" configKey="offset_days" options={[
              { value: "-3", label: "3 days before" },
              { value: "-2", label: "2 days before" },
              { value: "-1", label: "1 day before" },
              { value: "0", label: "Same day" },
              { value: "+1", label: "1 day after" },
              { value: "+2", label: "2 days after" },
              { value: "+3", label: "3 days after" },
            ]} placeholder="Same day" />
          </>
        )}
        {config.timing === "recurring" && (
          <>
            <FieldWithTriggerRef config={config} onChange={onChange} triggerFields={triggerFields} label="Start date" configKey="run_at_date" placeholder="{trigger.checkin_date}" />
            <FieldWithTriggerRef config={config} onChange={onChange} triggerFields={triggerFields} label="Until date" configKey="repeat_until_date" placeholder="{trigger.checkout_date}" />
            <FieldWithTriggerRef config={config} onChange={onChange} triggerFields={triggerFields} label="Time" configKey="run_at_time" placeholder="{trigger.event_time} or 07:00" />
            <DropdownField label="Repeat interval" configKey="repeat_interval" options={[
              { value: "1 day", label: "Every day" },
              { value: "2 days", label: "Every 2 days" },
              { value: "1 hour", label: "Every hour" },
              { value: "6 hours", label: "Every 6 hours" },
              { value: "12 hours", label: "Every 12 hours" },
            ]} />
            <DropdownField label="Start offset" configKey="offset_days" options={[
              { value: "0", label: "Same day" },
              { value: "+1", label: "+1 day after" },
              { value: "+2", label: "+2 days after" },
              { value: "-1", label: "1 day before" },
            ]} placeholder="Same day" />
          </>
        )}
      </>
    );
  }

  // TRIGGER NODE
  if (nodeType === "trigger") {
    const triggerType = config.triggerType || config.trigger_type || "webhook";
    return (
      <div className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Trigger: {triggerType}</p>
        {triggerType === "webhook" && (
          <>
            <div className="space-y-1">
              <Label className="text-xs">Expected Fields</Label>
              <Input value={config.expected_fields || ""} onChange={(e) => onChange("expected_fields", e.target.value)} placeholder="name, phone, checkin_date, checkout_date" className="h-8 text-xs" />
              <p className="text-[10px] text-muted-foreground">Comma-separated. These become available as {"{trigger.field}"} in other nodes.</p>
            </div>
            <FieldWithTriggerRef config={config} onChange={onChange} triggerFields={triggerFields} label="Description" configKey="description" placeholder="Receives hotel booking data" />
          </>
        )}
        {triggerType === "scheduled" && (
          <>
            <Input type="date" value={config.date || ""} onChange={(e) => onChange("date", e.target.value)} className="h-8 text-xs" />
            <Input type="time" value={config.time || ""} onChange={(e) => onChange("time", e.target.value)} className="h-8 text-xs" />
          </>
        )}
        {triggerType === "recurring" && (
          <>
            <Label className="text-xs">Start Date</Label>
            <Input type="date" value={config.start_date || ""} onChange={(e) => onChange("start_date", e.target.value)} className="h-8 text-xs" />
            <Label className="text-xs">End Date</Label>
            <Input type="date" value={config.end_date || ""} onChange={(e) => onChange("end_date", e.target.value)} className="h-8 text-xs" />
            <Label className="text-xs">Time</Label>
            <Input type="time" value={config.time || ""} onChange={(e) => onChange("time", e.target.value)} className="h-8 text-xs" />
            <DropdownField label="Repeat" configKey="repeat" options={[
              { value: "every day", label: "Every day" },
              { value: "every hour", label: "Every hour" },
              { value: "every week", label: "Every week" },
            ]} />
          </>
        )}
        {triggerType === "event" && (
          <DropdownField label="Event" configKey="event" options={[
            { value: "call.initiated", label: "Call Started" },
            { value: "call.answered", label: "Call Answered" },
            { value: "call.ended", label: "Call Ended" },
            { value: "call.missed", label: "Call Missed" },
            { value: "ticket.created", label: "Ticket Created" },
          ]} />
        )}
      </div>
    );
  }

  // ACTION NODES
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Configuration</p>

      {nodeType === "http_request" && (
        <>
          <FieldWithTriggerRef config={config} onChange={onChange} triggerFields={triggerFields} label="URL" configKey="url" placeholder="https://api.example.com/webhook" />
          <DropdownField label="Method" configKey="method" options={[
            { value: "POST", label: "POST" }, { value: "GET", label: "GET" },
            { value: "PUT", label: "PUT" }, { value: "DELETE", label: "DELETE" },
          ]} />
          <FieldWithTriggerRef config={config} onChange={onChange} triggerFields={triggerFields} label="Body" configKey="body" placeholder='{"guest": "{trigger.name}"}' type="textarea" />
        </>
      )}

      {nodeType === "send_whatsapp" && (
        <>
          <FieldWithTriggerRef config={config} onChange={onChange} triggerFields={triggerFields} label="Phone" configKey="phone" placeholder="{trigger.phone}" />
          <DropdownField label="Mode" configKey="whatsapp_mode" options={[
            { value: "template", label: "Template (MSG91)" },
            { value: "freetext", label: "Free Text" },
          ]} />
          {config.whatsapp_mode === "template" ? (() => {
            // Find selected template to get its variables and language
            const selectedTemplate = msg91Templates.find((t) => t.name === config.template_name);
            const templateLang = selectedTemplate?.languages?.[0];
            const templateVars = templateLang?.variables || [];

            return (
            <>
              {/* Sender Number */}
              {msg91Numbers.length > 1 ? (
                <div className="space-y-1">
                  <Label className="text-xs">Sender Number</Label>
                  <Select value={config.sender_number || ""} onValueChange={(v) => onChange("sender_number", v)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select number" /></SelectTrigger>
                    <SelectContent>
                      {msg91Numbers.map((n, i) => {
                        const num = String(n.integrated_number || n.number || "");
                        return <SelectItem key={i} value={num}>{num}</SelectItem>;
                      })}
                    </SelectContent>
                  </Select>
                </div>
              ) : msg91Numbers.length === 1 ? (
                <div className="space-y-1">
                  <Label className="text-xs">Sender Number</Label>
                  <Input value={String(msg91Numbers[0].integrated_number || msg91Numbers[0].number || "")} disabled className="h-8 text-xs bg-muted" />
                </div>
              ) : (
                <FieldWithTriggerRef config={config} onChange={onChange} triggerFields={triggerFields} label="Sender Number" configKey="sender_number" placeholder="MSG91 number" />
              )}

              {/* Template Name */}
              {msg91Templates.length > 0 ? (
                <div className="space-y-1">
                  <Label className="text-xs">Template Name</Label>
                  <Select value={config.template_name || ""} onValueChange={(v) => {
                    onChange("template_name", v);
                    // Auto-set language from template
                    const tpl = msg91Templates.find((t) => t.name === v);
                    const lang = tpl?.languages?.[0];
                    if (lang?.language) onChange("template_language", lang.language);
                    // Auto-create variable mappings
                    const vars = lang?.variables || [];
                    if (vars.length > 0) {
                      onChange("template_variables", JSON.stringify(vars.map((k) => ({ key: k, value: "" }))));
                    }
                  }}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select template" /></SelectTrigger>
                    <SelectContent>
                      {msg91Templates.filter((t) => t.languages?.[0]?.status === "APPROVED").map((t, i) => (
                        <SelectItem key={i} value={String(t.name)}>{t.name} ({t.languages?.[0]?.language || "?"})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <FieldWithTriggerRef config={config} onChange={onChange} triggerFields={triggerFields} label="Template Name" configKey="template_name" placeholder="welcome_msg" />
              )}

              {/* Language — auto-set from template */}
              {config.template_name && (
                <div className="space-y-1">
                  <Label className="text-xs">Language</Label>
                  <Input value={config.template_language || templateLang?.language || ""} disabled className="h-8 text-xs bg-muted" />
                </div>
              )}

              {/* Template Variables — only show after template selected, pre-populated from template */}
              {config.template_name && templateVars.length > 0 && (
                <>
                  <Separator />
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Template Variables</p>
                  {(() => {
                    let vars: { key: string; value: string; manual?: boolean }[] = [];
                    try { vars = JSON.parse(config.template_variables || "[]"); } catch { vars = []; }
                    // Ensure all template vars are present
                    if (vars.length === 0 || vars.length !== templateVars.length) {
                      vars = templateVars.map((k) => ({ key: k, value: vars.find((v) => v.key === k)?.value || "", manual: vars.find((v) => v.key === k)?.manual }));
                    }
                    return (
                      <div className="space-y-2">
                        {vars.map((v, i) => (
                          <div key={i} className="flex gap-1.5 items-center">
                            <span className="text-xs font-mono text-muted-foreground w-20 shrink-0">{v.key}</span>
                            <span className="text-xs text-muted-foreground">=</span>
                            {triggerFields.length > 0 && !v.manual && (v.value === "" || v.value.startsWith("{trigger.")) ? (
                              <Select value={v.value} onValueChange={(val) => {
                                if (val === "__manual__") {
                                  const updated = [...vars]; updated[i] = { ...v, value: "", manual: true };
                                  onChange("template_variables", JSON.stringify(updated));
                                } else {
                                  const updated = [...vars]; updated[i] = { ...v, value: val, manual: false };
                                  onChange("template_variables", JSON.stringify(updated));
                                }
                              }}>
                                <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="Select value" /></SelectTrigger>
                                <SelectContent>
                                  {triggerFields.map((f) => (
                                    <SelectItem key={f} value={`{trigger.${f}}`}>{`{trigger.${f}}`}</SelectItem>
                                  ))}
                                  <SelectItem value="__manual__">Enter manually</SelectItem>
                                </SelectContent>
                              </Select>
                            ) : (
                              <div className="flex gap-1 flex-1 items-center">
                                <BufferedInput value={v.value} onChange={(val) => {
                                  const updated = [...vars]; updated[i] = { ...v, value: val, manual: true };
                                  onChange("template_variables", JSON.stringify(updated));
                                }} placeholder="{trigger.name}" className="h-7 text-xs flex-1" />
                                {triggerFields.length > 0 && (
                                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0 text-muted-foreground" title="Switch to trigger variable" onClick={() => {
                                    const updated = [...vars]; updated[i] = { ...v, value: "", manual: false };
                                    onChange("template_variables", JSON.stringify(updated));
                                  }}>{"\u21A9"}</Button>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </>
              )}
            </>
            );
          })() : (
            <>
              <FieldWithTriggerRef config={config} onChange={onChange} triggerFields={triggerFields} label="Message" configKey="message" placeholder="Hello {trigger.name}!" type="textarea" />
              <FieldWithTriggerRef config={config} onChange={onChange} triggerFields={triggerFields} label="Template ID" configKey="template_id" placeholder="Optional legacy template" />
            </>
          )}
        </>
      )}

      {nodeType === "place_call" && (
        <>
          <FieldWithTriggerRef config={config} onChange={onChange} triggerFields={triggerFields} label="Destination" configKey="destination" placeholder="{trigger.phone}" />
          {bots.length > 0 ? (
            <div className="space-y-1">
              <Label className="text-xs">Bot</Label>
              <Select value={config.bot_id || ""} onValueChange={(v) => {
                onChange("bot_id", v);
                const bot = bots.find((b) => b.id === v);
                if (bot?.wss_url) onChange("wss_url", bot.wss_url);
              }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select bot..." /></SelectTrigger>
                <SelectContent>
                  {bots.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  <SelectItem value="__none__">No bot (direct call)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : (
            <FieldWithTriggerRef config={config} onChange={onChange} triggerFields={triggerFields} label="Bot ID" configKey="bot_id" placeholder="Bot ID or leave empty" />
          )}
          {dids.length > 0 ? (
            <div className="space-y-1">
              <Label className="text-xs">Caller ID</Label>
              <Select value={config.caller_id || ""} onValueChange={(v) => onChange("caller_id", v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select DID..." /></SelectTrigger>
                <SelectContent>
                  {dids.map((d) => <SelectItem key={d.number} value={d.number}>{d.number}{d.description ? ` — ${d.description}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <FieldWithTriggerRef config={config} onChange={onChange} triggerFields={triggerFields} label="Caller ID" configKey="caller_id" placeholder="08065978002" />
          )}
          {/* Custom Variables to pass to the call */}
          <Separator />
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Variables</p>
          <p className="text-[10px] text-muted-foreground">Pass trigger data to the AI bot as call variables</p>
          {(() => {
            // Parse existing variables from config (stored as JSON string)
            let vars: { key: string; value: string }[] = [];
            try { vars = JSON.parse(config.variables || "[]"); } catch { vars = []; }

            return (
              <div className="space-y-2">
                {vars.map((v, i) => (
                  <div key={i} className="flex gap-1.5 items-center">
                    <Input value={v.key} onChange={(e) => {
                      const updated = [...vars]; updated[i] = { ...v, key: e.target.value };
                      onChange("variables", JSON.stringify(updated));
                    }} placeholder="key" className="h-7 text-xs flex-1" />
                    <span className="text-xs text-muted-foreground">=</span>
                    {triggerFields.length > 0 ? (
                      <Select value={v.value} onValueChange={(val) => {
                        const updated = [...vars]; updated[i] = { ...v, value: val === "__manual__" ? "" : val };
                        onChange("variables", JSON.stringify(updated));
                      }}>
                        <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="value" /></SelectTrigger>
                        <SelectContent>
                          {triggerFields.map((f) => (
                            <SelectItem key={f} value={`{trigger.${f}}`}>{`{trigger.${f}}`}</SelectItem>
                          ))}
                          <SelectItem value="__manual__">Enter manually</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input value={v.value} onChange={(e) => {
                        const updated = [...vars]; updated[i] = { ...v, value: e.target.value };
                        onChange("variables", JSON.stringify(updated));
                      }} placeholder="{trigger.name}" className="h-7 text-xs flex-1" />
                    )}
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive shrink-0" onClick={() => {
                      const updated = vars.filter((_, j) => j !== i);
                      onChange("variables", JSON.stringify(updated));
                    }}>x</Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" className="h-7 text-xs w-full" onClick={() => {
                  onChange("variables", JSON.stringify([...vars, { key: "", value: "" }]));
                }}>+ Add Variable</Button>
              </div>
            );
          })()}
        </>
      )}

      {nodeType === "create_ticket" && (
        <>
          <DropdownField label="Priority" configKey="priority" options={[
            { value: "low", label: "Low" }, { value: "normal", label: "Normal" },
            { value: "high", label: "High" }, { value: "urgent", label: "Urgent" },
          ]} />
          <FieldWithTriggerRef config={config} onChange={onChange} triggerFields={triggerFields} label="Category" configKey="category" placeholder="general" />
          <FieldWithTriggerRef config={config} onChange={onChange} triggerFields={triggerFields} label="Summary" configKey="summary" placeholder="{trigger.summary}" />
          <FieldWithTriggerRef config={config} onChange={onChange} triggerFields={triggerFields} label="Details" configKey="details" placeholder="Details..." type="textarea" />
          <FieldWithTriggerRef config={config} onChange={onChange} triggerFields={triggerFields} label="Guest Name" configKey="guest_name" placeholder="{trigger.name}" />
          <FieldWithTriggerRef config={config} onChange={onChange} triggerFields={triggerFields} label="Room Number" configKey="room_number" placeholder="{trigger.room}" />
        </>
      )}

      {nodeType === "condition" && (
        <>
          <FieldWithTriggerRef config={config} onChange={onChange} triggerFields={triggerFields} label="Field" configKey="field" placeholder="{trigger.priority}" />
          <DropdownField label="Operator" configKey="operator" options={[
            { value: "==", label: "Equals (==)" }, { value: "!=", label: "Not equals (!=)" },
            { value: ">", label: "Greater than (>)" }, { value: "<", label: "Less than (<)" },
            { value: "contains", label: "Contains" }, { value: "exists", label: "Exists" },
          ]} />
          <FieldWithTriggerRef config={config} onChange={onChange} triggerFields={triggerFields} label="Value" configKey="value" placeholder="high" />
        </>
      )}

      {nodeType === "delay" && (
        <DropdownField label="Duration" configKey="duration" options={[
          { value: "30 seconds", label: "30 seconds" }, { value: "1 minute", label: "1 minute" },
          { value: "5 minutes", label: "5 minutes" }, { value: "15 minutes", label: "15 minutes" },
          { value: "30 minutes", label: "30 minutes" }, { value: "1 hour", label: "1 hour" },
          { value: "2 hours", label: "2 hours" }, { value: "6 hours", label: "6 hours" },
          { value: "12 hours", label: "12 hours" }, { value: "1 day", label: "1 day" },
        ]} />
      )}

      {nodeType === "repeat_daily" && (
        <>
          <FieldWithTriggerRef config={config} onChange={onChange} triggerFields={triggerFields} label="Start from date" configKey="run_at_date" placeholder="{trigger.checkin_date}" />
          <FieldWithTriggerRef config={config} onChange={onChange} triggerFields={triggerFields} label="Until date" configKey="repeat_until_date" placeholder="{trigger.checkout_date}" />
          <FieldWithTriggerRef config={config} onChange={onChange} triggerFields={triggerFields} label="Time" configKey="run_at_time" placeholder="{trigger.event_time} or 07:00" />
          <DropdownField label="Start offset" configKey="offset_days" options={[
            { value: "0", label: "Same day" }, { value: "+1", label: "+1 day after" },
            { value: "+2", label: "+2 days after" }, { value: "-1", label: "1 day before" },
          ]} />
        </>
      )}

      {nodeType === "log" && (
        <FieldWithTriggerRef config={config} onChange={onChange} triggerFields={triggerFields} label="Message" configKey="message" placeholder="Workflow step reached" />
      )}

      <TimingSection />

      <Separator />
      <p className="text-[10px] text-muted-foreground">
        Use {"{trigger.field}"} to reference webhook data. Use {"{step.nodeId.field}"} for previous step output.
      </p>
    </div>
  );
}
