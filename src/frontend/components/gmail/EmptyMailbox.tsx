import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

function MailIllustration() {
  return (
    <svg
      width="180"
      height="120"
      viewBox="0 0 180 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="20" y="20" width="80" height="44" rx="12" className="fill-muted dark:fill-muted/60 stroke-border" strokeWidth="1.5" />
      <path d="M36 64 L32 76 L48 64" className="fill-muted dark:fill-muted/60 stroke-border" strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="32" y="32" width="48" height="4" rx="2" className="fill-muted-foreground/20" />
      <rect x="32" y="42" width="36" height="4" rx="2" className="fill-muted-foreground/15" />
      <circle cx="32" cy="52" r="3" className="fill-muted-foreground/12" />
      <rect x="80" y="50" width="80" height="40" rx="12" className="fill-primary/10 dark:fill-primary/15 stroke-primary/30" strokeWidth="1.5" />
      <path d="M144 90 L148 100 L132 90" className="fill-primary/10 dark:fill-primary/15 stroke-primary/30" strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="92" y="62" width="52" height="4" rx="2" className="fill-primary/20" />
      <rect x="92" y="72" width="32" height="4" rx="2" className="fill-primary/15" />
      <circle cx="14" cy="46" r="2" className="fill-muted-foreground/10" />
      <circle cx="168" cy="66" r="2" className="fill-primary/15" />
      <circle cx="110" cy="16" r="2.5" className="fill-muted-foreground/10" />
    </svg>
  );
}

/**
 * Empty state for the Gmail comms inbox. The mailbox is empty until a contact
 * with an email is registered — that's what ingestion searches on — so the CTA
 * points at the company Rolodex.
 */
export function EmptyMailbox() {
  return (
    <div className="flex items-center justify-center p-4">
      <Empty className="py-12">
        <EmptyHeader>
          <EmptyMedia>
            <MailIllustration />
          </EmptyMedia>
          <EmptyTitle>No emails yet</EmptyTitle>
          <EmptyDescription>
            Add a contact with an email address (Company → Rolodex → Add Contact). Once added,
            background ingestion will automatically pull their mail and populate this inbox.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={() => { window.location.href = "/admin/companies"; }}>Add Contact</Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}
