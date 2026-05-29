"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Check, ChevronRight, Phone, Users, PhoneCall, Zap } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { users as pbxUsers } from "@/lib/pbx/client";
import { didPool } from "@/lib/did-pool/client";

interface Step {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  href: string;
  check: () => Promise<boolean>;
}

export function OnboardingBanner() {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();
  const [steps, setSteps] = useState<(Step & { done: boolean })[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  const stepDefs: Step[] = [
    {
      id: "users",
      label: "Create Users",
      description: "Add team members with SIP extensions",
      icon: Users,
      href: `/dashboard/${orgId}/users`,
      check: async () => {
        try { const u = await pbxUsers.list(); return u.length > 1; } catch { return false; }
      },
    },
    {
      id: "number",
      label: "Get a Phone Number",
      description: "Buy a DID from the marketplace",
      icon: Phone,
      href: `/dashboard/${orgId}/dids`,
      check: async () => {
        try { const my = await didPool.my(); return my.assigned.length > 0 || my.pending.length > 0; } catch { return false; }
      },
    },
    {
      id: "routing",
      label: "Configure Routing",
      description: "Set where calls go (extension, queue, bot)",
      icon: PhoneCall,
      href: `/dashboard/${orgId}/dids`,
      check: async () => {
        try {
          const my = await didPool.my();
          return my.assigned.some(d => d.routing_type && d.routing_destination);
        } catch { return false; }
      },
    },
    {
      id: "live",
      label: "Go Live",
      description: "Your phone number is ready to receive calls",
      icon: Zap,
      href: `/dashboard/${orgId}/calls`,
      check: async () => {
        try {
          const my = await didPool.my();
          return my.assigned.some(d => d.routing_type && d.routing_destination && d.status === "active");
        } catch { return false; }
      },
    },
  ];

  useEffect(() => {
    // Check if dismissed
    const key = `onboarding_dismissed_${orgId}`;
    if (typeof window !== "undefined" && localStorage.getItem(key)) {
      setDismissed(true);
      setLoading(false);
      return;
    }
    checkSteps();
  }, [orgId]);

  async function checkSteps() {
    setLoading(true);
    const results = await Promise.all(
      stepDefs.map(async (s) => ({ ...s, done: await s.check() }))
    );
    setSteps(results);
    setLoading(false);
  }

  function handleDismiss() {
    const key = `onboarding_dismissed_${orgId}`;
    if (typeof window !== "undefined") localStorage.setItem(key, "1");
    setDismissed(true);
  }

  if (loading || dismissed) return null;

  const completedCount = steps.filter(s => s.done).length;
  const allDone = completedCount === steps.length;

  // Don't show if all steps complete
  if (allDone) return null;

  return (
    <Card className="border-dashed">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-medium">Get started with Astradial</p>
            <p className="text-xs text-muted-foreground">{completedCount} of {steps.length} steps complete</p>
          </div>
          <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={handleDismiss}>Dismiss</Button>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {steps.map((step, i) => (
            <button
              key={step.id}
              onClick={() => router.push(step.href)}
              className={`flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-colors hover:bg-accent/50 ${step.done ? "border-primary/30 bg-primary/5" : ""}`}
            >
              <div className="flex items-center gap-2 w-full">
                <div className={`flex items-center justify-center h-6 w-6 rounded-full text-xs ${step.done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                  {step.done ? <Check className="h-3 w-3" /> : i + 1}
                </div>
                <span className="text-sm font-medium flex-1">{step.label}</span>
              </div>
              <p className="text-[11px] text-muted-foreground">{step.description}</p>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
