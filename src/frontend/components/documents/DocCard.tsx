import { ArrowUpRight } from "lucide-react";
import React from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import {
  DocTypeBadge,
  formatDocDate,
  type PublicDocument,
  SourceTypeIcon,
  TagChip,
  type DocumentSummary,
} from "./shared";

type CardDoc = Pick<
  PublicDocument | DocumentSummary,
  "id" | "title" | "sourceType" | "docType" | "tags" | "description" | "createdAt"
>;

/** Shared doc card used on /docs and /docs/view/[slug]. Links to /docs/[id]. */
export function DocCard({ doc, className }: { doc: CardDoc; className?: string }) {
  return (
    <a
      href={`/docs/${doc.id}`}
      className={cn(
        "group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        className,
      )}
    >
      <Card className="h-full ring-1 ring-border/40 transition-colors group-hover:ring-border/80">
        <CardHeader className="gap-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2">
              <SourceTypeIcon
                sourceType={doc.sourceType}
                className="mt-0.5 shrink-0 text-muted-foreground"
              />
              <CardTitle className="text-base leading-snug">{doc.title}</CardTitle>
            </div>
            <ArrowUpRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
          {doc.description ? (
            <p className="line-clamp-2 text-sm text-muted-foreground">{doc.description}</p>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <DocTypeBadge docType={doc.docType} />
            {doc.tags.slice(0, 4).map((tag) => (
              <TagChip key={tag} tag={tag} />
            ))}
            {doc.tags.length > 4 ? (
              <span className="text-[11px] text-muted-foreground">+{doc.tags.length - 4}</span>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">{formatDocDate(doc.createdAt)}</p>
        </CardContent>
      </Card>
    </a>
  );
}
