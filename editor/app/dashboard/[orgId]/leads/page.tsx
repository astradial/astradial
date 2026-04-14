"use client";

import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";

export default function Page() {
  const router = useRouter();
  const { orgId } = useParams<{ orgId: string }>();
  useEffect(() => { router.replace(`/dashboard/${orgId}/crm/leads`); }, [router, orgId]);
  return null;
}
