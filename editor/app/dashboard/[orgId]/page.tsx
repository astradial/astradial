"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

export default function OrgPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/dashboard/${orgId}/overview`);
  }, [orgId, router]);

  return null;
}
