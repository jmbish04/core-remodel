/**
 * @fileoverview LinksField — controlled web/social links editor.
 *
 * A row-per-link editor over `{ url, type }` pairs used by the showroom intake
 * form (the created store's `links` array). Purely controlled — no fetch — so
 * the parent owns the state and includes the rows in its POST body. The link
 * type vocabulary + labels exported here are the single source of truth, reused
 * by the store-viewport ManageLinksModal.
 */

import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Link-type vocabulary ─────────────────────────────────────────────────────

export const LINK_TYPES = [
  "WEBSITE",
  "INSTAGRAM",
  "PINTEREST",
  "FACEBOOK",
  "OTHER",
] as const;

export type LinkType = (typeof LINK_TYPES)[number];

export const LINK_TYPE_LABELS: Record<LinkType, string> = {
  WEBSITE: "Website",
  INSTAGRAM: "Instagram",
  PINTEREST: "Pinterest",
  FACEBOOK: "Facebook",
  OTHER: "Other",
};

/** Coerce an arbitrary stored `type` string to a known LinkType (fallback OTHER). */
export function asLinkType(v: string | null | undefined): LinkType {
  return (LINK_TYPES as readonly string[]).includes(v ?? "")
    ? (v as LinkType)
    : "OTHER";
}

// ─── Controlled editor ────────────────────────────────────────────────────────

export interface IntakeLink {
  url: string;
  type: LinkType;
}

export function LinksField({
  value,
  onChange,
}: {
  value: IntakeLink[];
  onChange: (rows: IntakeLink[]) => void;
}) {
  const update = (i: number, patch: Partial<IntakeLink>) =>
    onChange(value.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const add = () => onChange([...value, { url: "", type: "WEBSITE" }]);

  return (
    <div className="space-y-2">
      {value.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No links yet — add the website, social profiles, or anything else.
        </p>
      )}
      {value.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <Select
            value={row.type}
            onValueChange={(v) => update(i, { type: v as LinkType })}
          >
            <SelectTrigger className="w-32 shrink-0 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LINK_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {LINK_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={row.url}
            onChange={(e) => update(i, { url: e.target.value })}
            placeholder="https://…"
            aria-label={`${LINK_TYPE_LABELS[row.type]} URL`}
            className="flex-1 text-sm"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => remove(i)}
            aria-label="Remove link"
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={add}
      >
        <Plus className="size-3.5" /> Add link
      </Button>
    </div>
  );
}
