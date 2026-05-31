"use client";

import { formatDistanceToNow } from "date-fns";
import { Archive, CheckCircle2, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { CampaignStatusPill } from "@/components/campaigns/CampaignStatusPill";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { showToast } from "@/components/ui/Toast";
import { type CampaignTemplate, templates } from "@/lib/campaigns/client";

function relTime(iso: string | null | undefined): string {
  if (!iso) return "No edits";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "No edits";
  }
}

export default function StudioListPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();
  const [data, setData] = useState<CampaignTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await templates.list({ limit: 100 });
      setData(res.data);
    } catch (e: unknown) {
      showToast((e as Error).message, "error");
    }
    setLoading(false);
  }

  // Per UI.md §5 "New template behaviour — no modal":
  // create an Untitled draft immediately, then jump to the editor.
  // Matches handoff app.jsx:30 (templateId: "__new__").
  async function handleNew() {
    if (creating) return;
    setCreating(true);
    try {
      const t = await templates.create({ name: "Untitled template" });
      router.push(`/dashboard/${orgId}/campaigns/studio/${t.id}`);
    } catch (e: unknown) {
      showToast((e as Error).message, "error");
      setCreating(false);
    }
  }

  async function handlePublish(t: CampaignTemplate) {
    try {
      await templates.publish(t.id);
      showToast("Published", "success");
      load();
    } catch (e: unknown) {
      showToast((e as Error).message, "error");
    }
  }

  async function handleArchive(t: CampaignTemplate) {
    try {
      await templates.archive(t.id);
      showToast("Archived", "success");
      load();
    } catch (e: unknown) {
      showToast((e as Error).message, "error");
    }
  }

  async function handleDelete(t: CampaignTemplate) {
    if (!confirm(`Delete template "${t.name}"? This cannot be undone.`)) return;
    try {
      await templates.delete(t.id);
      showToast("Deleted", "success");
      load();
    } catch (e: unknown) {
      showToast((e as Error).message, "error");
    }
  }

  return (
    <div className="cmp-page-pad">
      <div className="cmp-page-actions-row">
        <div>
          <h1 className="cmp-page-heading">Studio</h1>
          <p className="cmp-page-subheading">Reusable workflow templates for outreach campaigns</p>
        </div>
        <button
          type="button"
          className="cmp-btn cmp-btn-default cmp-btn-sm"
          onClick={handleNew}
          disabled={creating}
        >
          <Plus size={14} /> {creating ? "Opening…" : "New template"}
        </button>
      </div>

      <div className="cmp-data-table-wrap">
        <table className="cmp-data-table">
          <thead>
            <tr>
              <th>Template</th>
              <th>Days</th>
              <th>Status</th>
              <th>Version</th>
              <th>Used by</th>
              <th>Last edit</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="text-center text-muted-foreground py-10">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && data.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-muted-foreground py-10">
                  No templates yet. Click <strong>New template</strong> to start.
                </td>
              </tr>
            )}
            {data.map((t) => {
              const days = Array.isArray(t.workflow?.days) ? t.workflow.days.length : 0;
              return (
                <tr
                  key={t.id}
                  onClick={() => router.push(`/dashboard/${orgId}/campaigns/studio/${t.id}`)}
                >
                  <td>
                    <div className="font-medium">{t.name}</div>
                    {t.description && (
                      <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>
                    )}
                  </td>
                  <td className="tabular-nums">{days}</td>
                  <td>
                    <CampaignStatusPill status={t.status} />
                  </td>
                  <td className="font-mono text-xs">v{t.version}</td>
                  <td className="text-[13px]">
                    {t.campaign_count && t.campaign_count > 0 ? (
                      <span>
                        {t.campaign_count} {t.campaign_count === 1 ? "campaign" : "campaigns"}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Not in use</span>
                    )}
                  </td>
                  <td className="text-[13px] text-muted-foreground">{relTime(t.updatedAt)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {t.status === "draft" && (
                          <DropdownMenuItem onClick={() => handlePublish(t)}>
                            <CheckCircle2 className="h-4 w-4 mr-2" /> Publish
                          </DropdownMenuItem>
                        )}
                        {t.status !== "archived" && (
                          <DropdownMenuItem onClick={() => handleArchive(t)}>
                            <Archive className="h-4 w-4 mr-2" /> Archive
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={() => handleDelete(t)}
                          className="text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
