import {
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleSlashIcon,
  PlusIcon,
  ShieldIcon,
  XIcon,
} from "lucide-react";
import { Avatar, AvatarFallback } from "src/frontend/components/ui/avatar";
import { Badge } from "src/frontend/components/ui/badge";
import { Button } from "src/frontend/components/ui/button";
import { Separator } from "src/frontend/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "src/frontend/components/ui/table";

type Outcome = "success" | "denied" | "alert";

interface Entry {
  ts: string;
  actor: { name: string; initials: string; tone: string };
  action: string;
  resource: string;
  ip: string;
  location: string;
  outcome: Outcome;
}

const ENTRIES: Entry[] = [
  { ts: "12:48:22", actor: { name: "Ada Lovelace", initials: "AL", tone: "bg-rose-500/15" }, action: "auth.session.create", resource: "session_8412c", ip: "203.0.113.42", location: "Dublin, IE", outcome: "success" },
  { ts: "12:46:09", actor: { name: "Grace Hopper", initials: "GH", tone: "bg-amber-500/15" }, action: "iam.role.update", resource: "user:linus → admin", ip: "198.51.100.7", location: "Boston, US", outcome: "success" },
  { ts: "12:42:41", actor: { name: "—", initials: "?", tone: "bg-muted" }, action: "auth.login.attempt", resource: "user:alan", ip: "45.92.180.220", location: "Tor exit node", outcome: "alert" },
  { ts: "12:38:11", actor: { name: "Alan Turing", initials: "AT", tone: "bg-sky-500/15" }, action: "billing.method.add", resource: "card_••4242", ip: "203.0.113.91", location: "London, UK", outcome: "success" },
  { ts: "12:30:00", actor: { name: "Linus Torvalds", initials: "LT", tone: "bg-emerald-500/15" }, action: "kv.bucket.delete", resource: "bucket:tmp-archive", ip: "192.0.2.55", location: "Helsinki, FI", outcome: "denied" },
  { ts: "12:21:52", actor: { name: "Margaret Hamilton", initials: "MH", tone: "bg-violet-500/15" }, action: "secrets.rotate", resource: "key:sk_live_8f4ad", ip: "198.51.100.18", location: "Boston, US", outcome: "success" },
  { ts: "12:18:04", actor: { name: "—", initials: "?", tone: "bg-muted" }, action: "webhook.delivery.failed", resource: "wh_2210 (×3)", ip: "—", location: "—", outcome: "alert" },
];

const OUTCOME: Record<Outcome, { label: string; cls: string; Icon: typeof CircleCheckIcon }> = {
  success: { label: "Allowed", cls: "border-emerald-500/30 text-emerald-700 dark:text-emerald-400", Icon: CircleCheckIcon },
  denied: { label: "Denied", cls: "border-amber-500/30 text-amber-700 dark:text-amber-400", Icon: CircleSlashIcon },
  alert: { label: "Suspicious", cls: "border-destructive/30 text-destructive", Icon: CircleAlertIcon },
};

interface Chip {
  field: string;
  op: string;
  value: string;
  tone?: "include" | "exclude" | "default";
}

const ACTIVE_CHIPS: Chip[] = [
  { field: "Outcome", op: "is any of", value: "Denied, Suspicious", tone: "include" },
  { field: "Actor", op: "is", value: "Ada Lovelace", tone: "include" },
  { field: "Resource", op: "contains", value: "auth", tone: "default" },
  { field: "IP", op: "is not", value: "internal", tone: "exclude" },
  { field: "When", op: "in", value: "last 24h", tone: "default" },
];

export function TableAuditLogShowcasePage() {
  return (
    <div className="min-h-svh bg-background px-6 py-12">
      <div className="mx-auto max-w-6xl">
        <header className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 font-heading text-xl">
              <ShieldIcon className="size-5 text-muted-foreground" />
              Audit log
            </h1>
            <p className="text-muted-foreground text-sm">
              Security events · last 24h · 7 of 1,284
            </p>
          </div>
          <Button size="sm" variant="outline">Export to SIEM</Button>
        </header>

        <div className="rounded-xl border bg-card shadow-xs/5">
          {/* Active filter chips bar */}
          <div className="flex flex-col gap-2 border-b p-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
                Filters
              </span>
              <Separator orientation="vertical" className="h-4" />
              <div className="flex flex-1 flex-wrap items-center gap-1.5">
                {ACTIVE_CHIPS.map((c, i) => (
                  <Chip key={`${c.field}-${i}`} chip={c} />
                ))}
                <Button size="xs" variant="ghost" className="border-dashed" >
                  <PlusIcon />
                  Add
                </Button>
              </div>
              <Button size="xs" variant="ghost" className="text-muted-foreground">
                <XIcon />
                Clear all
              </Button>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="ps-4 w-28">Time</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>IP / Location</TableHead>
                <TableHead className="pe-4">Outcome</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ENTRIES.map((e, i) => {
                const o = OUTCOME[e.outcome];
                return (
                  <TableRow
                    key={`${e.ts}-${i}`}
                    className={
                      e.outcome === "alert"
                        ? "bg-destructive/[0.04]"
                        : undefined
                    }
                  >
                    <TableCell className="ps-4 font-mono text-muted-foreground text-xs tabular-nums">
                      {e.ts}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar className={"size-6 " + e.actor.tone}>
                          <AvatarFallback className="bg-transparent font-medium text-[10px]">
                            {e.actor.initials}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm">{e.actor.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{e.action}</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">
                      {e.resource}
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-xs">{e.ip}</div>
                      <div className="text-muted-foreground text-xs">{e.location}</div>
                    </TableCell>
                    <TableCell className="pe-4">
                      <Badge variant="outline" className={"gap-1.5 " + o.cls}>
                        <o.Icon className="size-3" />
                        {o.label}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between border-t p-3 text-muted-foreground text-xs">
            <span>5 filters · auto-refresh every 30s</span>
            <Button size="xs" variant="ghost">Load older →</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip({ chip }: { chip: Chip }) {
  const tone =
    chip.tone === "include"
      ? "border-emerald-500/30 bg-emerald-500/5"
      : chip.tone === "exclude"
        ? "border-destructive/30 bg-destructive/5"
        : "border-border bg-background";
  const opTone =
    chip.tone === "include"
      ? "text-emerald-700 dark:text-emerald-400"
      : chip.tone === "exclude"
        ? "text-destructive"
        : "text-muted-foreground";
  return (
    <div className={"inline-flex items-center divide-x divide-border overflow-hidden rounded-md border text-xs " + tone}>
      <span className="px-2 py-1 font-medium">{chip.field}</span>
      <span className={"px-2 py-1 font-mono text-[11px] " + opTone}>{chip.op}</span>
      <button
        type="button"
        className="flex items-center gap-1 px-2 py-1 hover:bg-accent/60"
      >
        <span className="font-medium">{chip.value}</span>
        <ChevronDownIcon className="size-3 opacity-60" />
      </button>
      <button
        type="button"
        aria-label={`Remove ${chip.field} filter`}
        className="flex items-center px-1.5 py-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
}
