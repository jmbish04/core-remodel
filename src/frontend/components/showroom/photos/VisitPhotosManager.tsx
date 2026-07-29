/**
 * @fileoverview VisitPhotosManager (0040 P2+P3) — the manage-able visit-photos
 * body: photo STACKS (folders) + loose photos, multi-select, and a folder modal.
 *
 * Layout rule: render stacks first (one per active group), then loose photos
 * (group_id null). When there are NO groups at all, it's just the flat grid of
 * loose photos — no stack chrome. Selecting loose photos reveals a bar to delete
 * them or group them into a new folder. Clicking a stack opens the folder modal
 * (rename, describe, price, add/remove members, delete).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderPlus, Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { CurrencyInput } from "@/components/ui/currency-input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { OverviewNoteEditor } from "@/components/showroom/OverviewNoteEditor";
import { PhotoStack } from "../PhotoStack";
import { ShowroomPhotoPolaroid, type ShowroomPhoto } from "./ShowroomPhotoPolaroid";

interface ImageGroup {
  id: number;
  name: string;
  descriptionMarkdown: string | null;
  descriptionHtml: string | null;
  priceText: string | null;
  priceCents: number | null;
  coverImageId: number | null;
  memberCount: number;
  coverDeliveryUrl: string | null;
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });
  if (!res.ok) throw new Error((await res.text().catch(() => "")) || `HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function VisitPhotosManager({
  storeId,
  photos,
  onChanged,
  onPhotoSaved,
}: {
  storeId: number;
  photos: ShowroomPhoto[];
  /** Reload the parent's photo list after a mutation. */
  onChanged: () => void;
  /** Reload after a per-photo note save (lighter than onChanged). */
  onPhotoSaved: () => void;
}) {
  const [groups, setGroups] = useState<ImageGroup[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [namingOpen, setNamingOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [openGroupId, setOpenGroupId] = useState<number | null>(null);

  const loadGroups = useCallback(async () => {
    try {
      const data = await jsonFetch<{ groups: ImageGroup[] }>(
        `/api/showroom-stores/${storeId}/image-groups`,
      );
      setGroups(data.groups ?? []);
    } catch (e) {
      console.error("[image-groups]", e);
    }
  }, [storeId]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  // Bucket photos once per `photos` change instead of re-filtering every render.
  const { loose, membersByGroup } = useMemo(() => {
    const looseList: ShowroomPhoto[] = [];
    const byGroup = new Map<number, ShowroomPhoto[]>();
    for (const p of photos) {
      if (p.groupId == null) looseList.push(p);
      else {
        const list = byGroup.get(p.groupId) ?? [];
        list.push(p);
        byGroup.set(p.groupId, list);
      }
    }
    return { loose: looseList, membersByGroup: byGroup };
  }, [photos]);
  const membersOf = (groupId: number) => membersByGroup.get(groupId) ?? [];
  const openGroup = groups.find((g) => g.id === openGroupId) ?? null;

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const reload = useCallback(() => {
    onChanged();
    void loadGroups();
  }, [onChanged, loadGroups]);

  const createGroup = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await jsonFetch(`/api/showroom-stores/${storeId}/image-groups`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, imageIds: [...selected] }),
      });
      toast.success(`Folder "${name}" created`);
      setSelected(new Set());
      setNewName("");
      setNamingOpen(false);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create folder");
    } finally {
      setBusy(false);
    }
  };

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const r = await jsonFetch<{ deleted: number }>(
        `/api/showroom-stores/${storeId}/photos/bulk-delete`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ imageIds: [...selected] }),
        },
      );
      toast.success(`Deleted ${r.deleted} photo${r.deleted === 1 ? "" : "s"}`);
      setSelected(new Set());
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 space-y-5">
      {/* Selection bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => setNamingOpen(true)}>
              <FolderPlus className="size-3.5" /> Group into folder
            </Button>
            <Button size="sm" variant="destructive" className="gap-1.5" disabled={busy} onClick={deleteSelected}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />} Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Stacks (folders) */}
      {groups.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {groups.map((g) => {
            const imgs = membersOf(g.id).map((m) => m.deliveryUrl);
            return (
              <div key={g.id} className="space-y-1.5">
                <PhotoStack
                  images={g.coverDeliveryUrl ? [g.coverDeliveryUrl, ...imgs] : imgs}
                  count={`${g.memberCount} photo${g.memberCount === 1 ? "" : "s"}`}
                  onClick={() => setOpenGroupId(g.id)}
                />
                <div className="px-0.5">
                  <p className="truncate text-sm font-medium">{g.name}</p>
                  {g.priceText ? (
                    <p className="text-xs text-muted-foreground">{g.priceText}</p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Loose photos */}
      {loose.length === 0 && groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No photos yet. Upload a shot from your visit.</p>
      ) : loose.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {loose.map((photo) => (
            <div key={photo.id} className="group/vphoto relative">
              <button
                type="button"
                aria-label={selected.has(photo.id) ? "Deselect photo" : "Select photo"}
                onClick={() => toggle(photo.id)}
                className={cn(
                  "absolute left-1 top-1 z-20 flex size-6 items-center justify-center rounded-full border-2 text-white transition",
                  selected.has(photo.id)
                    ? "border-sky-400 bg-sky-500"
                    : "border-white/70 bg-black/40 opacity-0 group-hover/vphoto:opacity-100",
                )}
              >
                {selected.has(photo.id) ? "✓" : ""}
              </button>
              <CopyButton
                value={photo.deliveryUrl}
                label={`#${photo.id}`}
                title={`Copy image URL (#${photo.id})`}
                className="absolute right-1 top-1 z-20 opacity-0 group-hover/vphoto:opacity-100"
              />
              <ShowroomPhotoPolaroid photo={photo} onSaved={onPhotoSaved} />
            </div>
          ))}
        </div>
      ) : null}

      {/* Name-new-folder dialog */}
      <Dialog open={namingOpen} onOpenChange={(o) => !o && setNamingOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Name the folder</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="e.g. Kohler Purist faucet options"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void createGroup()}
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setNamingOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy || !newName.trim()} onClick={() => void createGroup()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Folder detail modal */}
      {openGroup && (
        <FolderModal
          key={openGroup.id}
          storeId={storeId}
          group={openGroup}
          members={membersOf(openGroup.id)}
          loose={loose}
          onClose={() => setOpenGroupId(null)}
          onChanged={reload}
        />
      )}
    </div>
  );
}

/** The folder detail modal: rename, describe, price, add/remove members, delete. */
function FolderModal({
  storeId,
  group,
  members,
  loose,
  onClose,
  onChanged,
}: {
  storeId: number;
  group: ImageGroup;
  members: ShowroomPhoto[];
  loose: ShowroomPhoto[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState(group.name);
  const [descMarkdown, setDescMarkdown] = useState(group.descriptionMarkdown ?? "");
  const [priceText, setPriceText] = useState(group.priceText ?? "");
  const [priceCents, setPriceCents] = useState<number | null>(group.priceCents);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  const base = `/api/showroom-stores/${storeId}/image-groups/${group.id}`;

  const save = async () => {
    setBusy(true);
    try {
      await jsonFetch(base, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || group.name,
          descriptionMarkdown: descMarkdown,
          priceText,
          priceCents,
        }),
      });
      toast.success("Folder saved");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const members_mutate = async (payload: { add?: number[]; remove?: number[] }) => {
    setBusy(true);
    try {
      await jsonFetch(`${base}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update photos");
    } finally {
      setBusy(false);
    }
  };

  const deleteFolder = async () => {
    setBusy(true);
    try {
      await jsonFetch(base, { method: "DELETE" });
      toast.success("Folder deleted — photos kept as loose");
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete folder");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[88vh] max-w-3xl flex-col gap-0 overflow-y-auto p-0">
        <DialogHeader className="p-5 pb-3">
          <DialogTitle>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-lg font-semibold"
              aria-label="Folder name"
            />
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 px-5 pb-5">
          {/* Members */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Photos ({members.length})
            </p>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {members.map((m) => (
                <div key={m.id} className="group/mem relative overflow-hidden rounded-lg ring-1 ring-border/40">
                  <img src={m.deliveryUrl} alt={m.altText ?? ""} className="aspect-square w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => void members_mutate({ remove: [m.id] })}
                    disabled={busy}
                    className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition hover:bg-destructive group-hover/mem:opacity-100"
                    title="Remove from folder"
                  >
                    <X className="size-3" />
                  </button>
                  <CopyButton
                    value={m.deliveryUrl}
                    label={`#${m.id}`}
                    title={`Copy image URL (#${m.id})`}
                    className="absolute bottom-1 left-1 opacity-0 group-hover/mem:opacity-100"
                  />
                </div>
              ))}
            </div>
            {loose.length > 0 && (
              <div className="mt-3">
                <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
                  {adding ? "Done adding" : `Add from loose photos (${loose.length})`}
                </Button>
                {adding && (
                  <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6">
                    {loose.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        disabled={busy}
                        onClick={() => void members_mutate({ add: [p.id] })}
                        className="overflow-hidden rounded-md ring-1 ring-border/40 transition hover:ring-sky-400"
                        title="Add to folder"
                      >
                        <img src={p.deliveryUrl} alt="" className="aspect-square w-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Description</p>
            <OverviewNoteEditor
              initialMarkdown={group.descriptionMarkdown}
              initialHtml={group.descriptionHtml}
              onChange={(v) => setDescMarkdown(v.markdown)}
            />
          </div>

          {/* Pricing */}
          <div className="max-w-xs">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Pricing</p>
            <CurrencyInput
              aria-label="Folder price"
              value={priceText}
              onValueChange={(text, cents) => {
                setPriceText(text);
                setPriceCents(cents);
              }}
            />
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-border/40 p-5">
          <Button variant="destructive" className="gap-1.5" disabled={busy} onClick={() => void deleteFolder()}>
            <Trash2 className="size-4" /> Delete folder
          </Button>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button disabled={busy} onClick={() => void save()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
