"use client";

import { useParams } from "next/navigation";

import { CampaignSettingsPanel } from "@/components/campaigns/CampaignSettingsPanel";

export default function CampaignSettingsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  return <CampaignSettingsPanel orgId={orgId} />;
}
