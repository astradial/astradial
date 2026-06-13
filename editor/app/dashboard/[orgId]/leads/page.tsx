"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Page() {
  const router = useRouter();
  const { orgId } = useParams<{ orgId: string }>();
  useEffect(() => {
    router.replace(`/dashboard/${orgId}/crm/leads`);
  }, [router, orgId]);
  return null;
}
