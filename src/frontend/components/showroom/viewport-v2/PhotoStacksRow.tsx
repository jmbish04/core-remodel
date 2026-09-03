/**
 * @fileoverview PhotoStacksRow — the stack index atop Showroom Photos (V2 item 6).
 *
 * A row of "pile of prints" stacks summarising the store's photo collections:
 *   - a Google Places stack (the stock listing photos), and
 *   - the user's own photos: ONE combined "Your uploads" stack when the user has
 *     not organised anything, OR one stack per image-group (folder) once they
 *     have (GET /:id/image-groups). Groups replace the single stack, they don't
 *     stack alongside it.
 *
 * Clicking the Places or uploads stack opens the corresponding collection below;
 * group stacks are visual for now (a later pass wires a per-group viewer).
 * Temporary V2 component.
 */
import { useEffect, useState } from "react";

import { PhotoStack } from "../PhotoStack";

interface ImageGroup {
  id: number;
  name: string;
  memberCount: number;
  coverDeliveryUrl: string | null;
}

function StackTile({
  label,
  images,
  count,
  onClick,
}: {
  label: string;
  images: string[];
  count: string;
  onClick?: () => void;
}) {
  if (images.length === 0) return null;
  return (
    <div className="flex flex-col items-center gap-2">
      <PhotoStack images={images.slice(0, 3)} count={count} onClick={onClick} />
      <span className="max-w-32 truncate text-center text-xs font-medium text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

export function PhotoStacksRow({
  storeId,
  placesImages,
  uploadImages,
  onOpenPlaces,
  onOpenUploads,
}: {
  storeId: number;
  placesImages: string[];
  uploadImages: string[];
  onOpenPlaces: () => void;
  onOpenUploads: () => void;
}) {
  const [groups, setGroups] = useState<ImageGroup[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/showroom-stores/${storeId}/image-groups`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => {
        const data = raw as { groups?: ImageGroup[] } | null;
        if (!cancelled && data?.groups) setGroups(data.groups);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  const hasAny = placesImages.length > 0 || uploadImages.length > 0 || groups.length > 0;
  if (!hasAny) return null;

  return (
    <div className="flex flex-wrap items-start gap-x-8 gap-y-4 rounded-xl bg-card p-5 ring-1 ring-border/40">
      <StackTile
        label="Google Places"
        images={placesImages}
        count={`${placesImages.length}`}
        onClick={onOpenPlaces}
      />
      {groups.length > 0 ? (
        // Organised: one stack per folder, replacing the single uploads stack.
        groups.map((g) => (
          <StackTile
            key={g.id}
            label={g.name}
            images={g.coverDeliveryUrl ? [g.coverDeliveryUrl] : []}
            count={`${g.memberCount}`}
          />
        ))
      ) : (
        // Unorganised: one combined stack of everything the user uploaded.
        <StackTile
          label="Your uploads"
          images={uploadImages}
          count={`${uploadImages.length}`}
          onClick={onOpenUploads}
        />
      )}
    </div>
  );
}
