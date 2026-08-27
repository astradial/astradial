"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { showToast } from "@/components/ui/Toast";
import {
  clickToCall,
  users as pbxUsers,
  queues as pbxQueues,
  dids as pbxDids,
  type PbxUser,
  type PbxQueue,
  type PbxDid,
} from "@/lib/pbx/client";

type FromType = "extension" | "external";
type ToType = "extension" | "queue" | "external";

interface CallForm {
  from: string;
  from_type: FromType;
  to: string;
  to_type: ToType;
  caller_id: string;
}

const DEFAULT_FORM: CallForm = {
  from: "",
  from_type: "extension",
  to: "",
  to_type: "extension",
  caller_id: "08065978002",
};

function cleanPhone(val: string) {
  const digits = val.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export interface InitiateCallDialogHandle {
  /**
   * Open the dialog with optional pre-filled form values. Used by Call
   * Logs' "Call" button on the expanded-row ContactCards so operators
   * can re-dial from history without re-typing.
   */
  openWith: (prefill?: Partial<CallForm>) => void;
}

/**
 * Self-contained Initiate Call dialog. Fetches its own user/queue/DID
 * lists. Rendered on both Live Calls and Call Logs page headers — keep
 * stateless from the parent so the two pages don't need to coordinate.
 * Parents that need to pre-fill the form (e.g. quick-call from a
 * contact card) can pass a ref and call `.openWith({...})`.
 */
export const InitiateCallDialog = forwardRef<InitiateCallDialogHandle>((_props, ref) => {
  const [open, setOpen] = useState(false);
  const [initiating, setInitiating] = useState(false);
  const [form, setForm] = useState<CallForm>(DEFAULT_FORM);

  useImperativeHandle(ref, () => ({
    openWith: (prefill) => {
      setForm((current) => ({ ...current, ...(prefill || {}) }));
      setOpen(true);
    },
  }), []);

  const [userList, setUserList] = useState<PbxUser[]>([]);
  const [queueList, setQueueList] = useState<PbxQueue[]>([]);
  const [didList, setDidList] = useState<PbxDid[]>([]);

  useEffect(() => {
    pbxUsers.list().then(setUserList).catch(() => {});
    pbxQueues.list().then(setQueueList).catch(() => {});
    pbxDids.list().then((dids) => {
      const active = dids.filter((d) => d.status === "active");
      setDidList(active);
      if (active.length > 0) {
        setForm((f) => ({ ...f, caller_id: active[0].number }));
      }
    }).catch(() => {});
  }, []);

  async function handleInitiate() {
    if (!form.from || !form.to) return;
    setInitiating(true);
    try {
      await clickToCall.initiate({
        from: form.from,
        from_type: form.from_type,
        to: form.to,
        to_type: form.to_type,
        caller_id: form.caller_id,
      });
      showToast("Call initiated — ringing 'From' first, then connecting to 'To'", "success");
      setOpen(false);
      setForm({ ...DEFAULT_FORM, caller_id: didList[0]?.number || DEFAULT_FORM.caller_id });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to initiate call", "error");
    } finally {
      setInitiating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Phone className="h-4 w-4 mr-1.5" />Initiate Call</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Initiate Call</DialogTitle>
          <DialogDescription>PBX calls &apos;From&apos; first, then connects to &apos;To&apos;</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* From */}
          <div className="space-y-1.5">
            <Label>From (rings first)</Label>
            <div className="grid grid-cols-3 gap-2">
              <Select value={form.from_type} onValueChange={(v) => setForm({ ...form, from_type: v as FromType, from: "" })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="extension">Extension</SelectItem>
                  <SelectItem value="external">Phone Number</SelectItem>
                </SelectContent>
              </Select>
              <div className="col-span-2">
                {form.from_type === "extension" ? (
                  <Select value={form.from} onValueChange={(v) => setForm({ ...form, from: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select extension" /></SelectTrigger>
                    <SelectContent>{userList.filter((u) => u.status === "active").map((u) => (
                      <SelectItem key={u.id} value={u.extension}>{u.extension} — {u.full_name || u.username}</SelectItem>
                    ))}</SelectContent>
                  </Select>
                ) : (
                  <Input value={form.from} onChange={(e) => setForm({ ...form, from: cleanPhone(e.target.value) })} placeholder="9876543210" maxLength={10} className="h-8 text-xs" />
                )}
              </div>
            </div>
          </div>
          {/* To */}
          <div className="space-y-1.5">
            <Label>To (connected after From answers)</Label>
            <div className="grid grid-cols-3 gap-2">
              <Select value={form.to_type} onValueChange={(v) => setForm({ ...form, to_type: v as ToType, to: "" })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="extension">Extension</SelectItem>
                  <SelectItem value="queue">Queue</SelectItem>
                  <SelectItem value="external">Phone Number</SelectItem>
                </SelectContent>
              </Select>
              <div className="col-span-2">
                {form.to_type === "extension" ? (
                  <Select value={form.to} onValueChange={(v) => setForm({ ...form, to: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select extension" /></SelectTrigger>
                    <SelectContent>{userList.filter((u) => u.status === "active").map((u) => (
                      <SelectItem key={u.id} value={u.extension}>{u.extension} — {u.full_name || u.username}</SelectItem>
                    ))}</SelectContent>
                  </Select>
                ) : form.to_type === "queue" ? (
                  <Select value={form.to} onValueChange={(v) => setForm({ ...form, to: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select queue" /></SelectTrigger>
                    <SelectContent>{queueList.filter((q) => q.status === "active").map((q) => (
                      <SelectItem key={q.id} value={q.number}>{q.number} — {q.name}</SelectItem>
                    ))}</SelectContent>
                  </Select>
                ) : (
                  <Input value={form.to} onChange={(e) => setForm({ ...form, to: cleanPhone(e.target.value) })} placeholder="9876543210" maxLength={10} className="h-8 text-xs" />
                )}
              </div>
            </div>
          </div>
          {/* Caller ID */}
          <div className="space-y-1.5">
            <Label>Caller ID</Label>
            {didList.length > 1 ? (
              <Select value={form.caller_id} onValueChange={(v) => setForm({ ...form, caller_id: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select DID" /></SelectTrigger>
                <SelectContent>
                  {didList.map((d) => (
                    <SelectItem key={d.id} value={d.number}>{d.number}{d.description ? ` — ${d.description}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input value={form.caller_id} disabled className="h-8 text-xs bg-muted" />
            )}
            <p className="text-[10px] text-muted-foreground">Number shown to the &apos;To&apos; party</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleInitiate} disabled={!form.from || !form.to || initiating}>
            {initiating ? "Calling..." : "Call"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
InitiateCallDialog.displayName = "InitiateCallDialog";
