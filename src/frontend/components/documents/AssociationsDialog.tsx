import { Link2, Loader2, Plus, X } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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

import {
  apiGet,
  apiSend,
  type DocumentAssociation,
  ENTITY_TYPES,
  type EntityType,
} from "./shared";

interface AssociationsResponse {
  success: boolean;
  associations: DocumentAssociation[];
}

export function AssociationsDialog({
  open,
  onOpenChange,
  documentId,
  documentTitle,
  initialAssociations,
}: {
  open: boolean;
  // Base UI Dialog — dismissal is controlled here, NOT via Radix onEscapeKeyDown props.
  onOpenChange: (next: boolean) => void;
  documentId: string;
  documentTitle: string;
  initialAssociations: DocumentAssociation[];
}) {
  const [associations, setAssociations] = useState<DocumentAssociation[]>(initialAssociations);
  const [entityType, setEntityType] = useState<EntityType>("company");
  const [entityId, setEntityId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAssociations(initialAssociations);
  }, [initialAssociations]);

  // Pre-seed the list from the server whenever the dialog opens — the parent
  // table doesn't carry association rows, so without this the dialog would
  // start empty until the first POST/DELETE response.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiGet<AssociationsResponse>(`/api/supporting-documents/${documentId}/associations`)
      .then((payload) => {
        if (!cancelled) setAssociations(payload.associations);
      })
      .catch(() => {
        /* keep whatever we had — POST/DELETE responses still refresh the list */
      });
    return () => {
      cancelled = true;
    };
  }, [open, documentId]);

  const add = useCallback(async () => {
    const trimmed = entityId.trim();
    if (!trimmed) {
      toast.error("Enter an entity ID");
      return;
    }
    setBusy(true);
    try {
      const payload = await apiSend<AssociationsResponse>(
        `/api/supporting-documents/${documentId}/associations`,
        "POST",
        { entityType, entityId: trimmed },
      );
      setAssociations(payload.associations ?? []);
      setEntityId("");
      toast.success("Association added");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add association");
    } finally {
      setBusy(false);
    }
  }, [documentId, entityId, entityType]);

  const remove = useCallback(
    async (assoc: DocumentAssociation) => {
      setBusy(true);
      try {
        const payload = await apiSend<AssociationsResponse>(
          `/api/supporting-documents/${documentId}/associations`,
          "DELETE",
          { entityType: assoc.entityType, entityId: assoc.entityId },
        );
        setAssociations(payload.associations ?? []);
        toast.success("Association removed");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to remove association");
      } finally {
        setBusy(false);
      }
    },
    [documentId],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="size-4" />
            Associations
          </DialogTitle>
        </DialogHeader>

        <p className="truncate text-sm text-muted-foreground">{documentTitle}</p>

        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,9rem)_1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Entity type
              </Label>
              <Select
                value={entityType}
                onValueChange={(value) => setEntityType(value as EntityType)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="assoc-entity-id"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                Entity ID
              </Label>
              <Input
                id="assoc-entity-id"
                value={entityId}
                onChange={(event) => setEntityId(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void add();
                  }
                }}
                placeholder="entity id"
                disabled={busy}
              />
            </div>
            <Button type="button" onClick={() => void add()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            </Button>
          </div>

          <div className="space-y-1.5">
            {associations.length === 0 ? (
              <p className="rounded-lg bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground ring-1 ring-border/30">
                No associations yet.
              </p>
            ) : (
              <ul className="divide-y divide-border/40 overflow-hidden rounded-lg ring-1 ring-border/40">
                {associations.map((assoc) => (
                  <li
                    key={`${assoc.entityType}-${assoc.entityId}`}
                    className="flex items-center justify-between gap-3 bg-card/60 px-3 py-2"
                  >
                    <span className="flex min-w-0 items-center gap-2 text-sm">
                      <span className="inline-flex items-center rounded-full bg-muted/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground ring-1 ring-border/30">
                        {assoc.entityType}
                      </span>
                      <span className="truncate font-mono text-xs text-foreground">
                        {assoc.entityId}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void remove(assoc)}
                      disabled={busy}
                      className="shrink-0 text-muted-foreground transition-colors hover:text-rose-400 disabled:opacity-50"
                      aria-label="Remove association"
                    >
                      <X className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
