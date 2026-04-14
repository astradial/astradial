"use client";

import { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import type { PbxUser } from "@/lib/pbx/client";

interface SipQrDialogProps {
  user: PbxUser;
  onClose: () => void;
}

export function SipQrDialog({ user, onClose }: SipQrDialogProps) {
  const sipServer = "devsip.astradial.com";
  const sipPort = "5080";
  const [copied, setCopied] = useState<string | null>(null);
  const [sipPassword, setSipPassword] = useState(user.sip_password || "");

  // Fetch SIP password from PBX API
  useEffect(() => {
    if (!sipPassword && user.id) {
      const token = typeof window !== "undefined" ? localStorage.getItem("pbx_org_token") || "" : "";
      fetch(`/api/pbx/users/${user.id}/sip-credentials`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((d) => { if (d.sip_password) setSipPassword(d.sip_password); })
        .catch(() => {});
    }
  }, [user.id, user.org_id, sipPassword]);

  // Zoiper QR provisioning format — plain text with key:value pairs
  const zoiperQr = [
    `server=${sipServer}`,
    `port=${sipPort}`,
    `username=${user.asterisk_endpoint}`,
    `password=${sipPassword}`,
    `transport=udp`,
    `protocol=sip`,
  ].join("\n");

  const credentials = [
    { label: "Server", value: sipServer },
    { label: "Port", value: sipPort },
    { label: "Username", value: user.asterisk_endpoint },
    { label: "Password", value: sipPassword || "Loading..." },
    { label: "Extension", value: user.extension },
    { label: "Transport", value: "UDP" },
  ];

  function copyToClipboard(value: string, label: string) {
    navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>SIP Credentials — Ext {user.extension}</DialogTitle>
          <DialogDescription>
            Scan QR with your softphone app or enter credentials manually
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center py-4">
          <div className="bg-white p-3 rounded-lg">
            <QRCodeSVG value={zoiperQr} size={180} level="M" />
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Scan with Zoiper, Opal, or any SIP softphone
          </p>
        </div>

        <Separator />

        <div className="space-y-2 text-sm">
          {credentials.map((cred) => (
            <div key={cred.label} className="flex items-center justify-between group">
              <span className="text-muted-foreground">{cred.label}</span>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-xs">{cred.value}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => copyToClipboard(cred.value, cred.label)}
                >
                  {copied === cred.label ? (
                    <Check className="h-3 w-3 text-green-500" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
