/**
 * @fileoverview Budget Command Center — contract payment compliance gates.
 *
 * The API evaluates every rule and supplies the rollup, gate verdicts, and
 * evidence. This read-only component only presents those results.
 */

import {
  AlertCircle,
  AlertOctagon,
  Check,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Minus,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  BudgetApiError,
  formatCents,
  getCompliance,
  useBudgetQuery,
  type ComplianceContract,
  type ComplianceGate,
} from "@/lib/budget-api";

const GATE_STATE = {
  pass: {
    label: "pass",
    icon: Check,
    badgeClassName: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
  },
  fail: {
    label: "fail",
    icon: X,
    badgeClassName: "border-destructive/30 bg-destructive/10 text-destructive",
  },
  warn: {
    label: "warn",
    icon: TriangleAlert,
    badgeClassName: "border-amber-500/30 bg-amber-500/10 text-amber-500",
  },
  na: {
    label: "n/a",
    icon: Minus,
    badgeClassName: "text-muted-foreground",
  },
} as const;

const OVERALL_STATE = {
  block: {
    label: "block",
    icon: AlertOctagon,
    variant: "destructive" as const,
    className: "",
  },
  warn: {
    label: "warn",
    icon: TriangleAlert,
    variant: "outline" as const,
    className: "border-amber-500/30 bg-amber-500/10 text-amber-500",
  },
  ok: {
    label: "ok",
    icon: CheckCircle2,
    variant: "outline" as const,
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
  },
} as const;

function contractDetails(contract: ComplianceContract): string {
  const parts = [contract.tradeLabel];
  if (contract.cslbLicenseNumber) parts.push(`CSLB #${contract.cslbLicenseNumber}`);
  if (contract.contractValueCents !== null) {
    parts.push(`contract ${formatCents(contract.contractValueCents)}`);
  }
  return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

function sanitizeEvidenceHtml(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed)\b[^>]*\/?>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
    .replace(/((?:href|src)\s*=\s*)(["'])\s*javascript:[^"']*\2/gi, "$1$2#$2");
}

function Evidence({ evidence }: { evidence: ComplianceGate["evidence"] }) {
  const markdown = evidence.markdown?.trim();
  const html = evidence.html?.trim();
  const className =
    "mt-0.5 text-xs text-muted-foreground [&_a]:underline [&_a]:underline-offset-2 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:my-0.5 [&_ul]:list-disc [&_ul]:pl-4";

  if (markdown) {
    return (
      <div className={className}>
        <ReactMarkdown>{markdown}</ReactMarkdown>
      </div>
    );
  }
  if (html) {
    return (
      <div className={className} dangerouslySetInnerHTML={{ __html: sanitizeEvidenceHtml(html) }} />
    );
  }
  return <p className="mt-0.5 text-xs text-muted-foreground">No evidence recorded.</p>;
}

function GateRow({ gate }: { gate: ComplianceGate }) {
  const state = GATE_STATE[gate.state];
  const StateIcon = state.icon;

  return (
    <li className="flex flex-col gap-2 border-t border-border px-4 py-3 sm:flex-row sm:items-start sm:gap-3">
      <Badge
        variant="outline"
        className={`w-fit min-w-16 justify-center ${state.badgeClassName}`}
        aria-label={`Gate state: ${state.label}`}
      >
        <StateIcon aria-hidden="true" data-icon="inline-start" />
        {state.label}
      </Badge>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{gate.label}</p>
        <Evidence evidence={gate.evidence} />
      </div>
    </li>
  );
}

function ContractCard({ contract }: { contract: ComplianceContract }) {
  const overall = OVERALL_STATE[contract.overallState];
  const OverallIcon = overall.icon;
  const details = contractDetails(contract);

  return (
    <Card size="sm" className="gap-0 py-0">
      <CardHeader className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{contract.vendorLabel}</h3>
          {details ? <p className="mt-0.5 text-xs text-muted-foreground">{details}</p> : null}
        </div>
        <Badge variant={overall.variant} className={overall.className}>
          <OverallIcon aria-hidden="true" data-icon="inline-start" />
          {overall.label}
        </Badge>
      </CardHeader>
      <CardContent className="px-0">
        <ul aria-label={`Payment gates for ${contract.vendorLabel}`}>
          {contract.gates.map((gate) => (
            <GateRow key={gate.gateType} gate={gate} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function ComplianceTab() {
  const { data, error, isLoading, refetch } = useBudgetQuery(getCompliance, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
          <ShieldCheck aria-hidden="true" className="size-4 text-foreground" />
        </span>
        <div>
          <h2 className="text-base font-semibold leading-snug text-foreground">Compliance</h2>
          <p className="text-xs text-muted-foreground">
            Payment gates checked before money moves on each contract.
          </p>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div
            className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"
            role="status"
          >
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            Loading compliance gates…
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center" role="alert">
            <AlertCircle aria-hidden="true" className="size-6 text-destructive" />
            <div>
              <p className="text-sm font-medium text-foreground">Couldn't load compliance gates</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {error instanceof BudgetApiError ? `HTTP ${error.status} — ` : ""}
                {error.message}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={refetch}>
              Try again
            </Button>
          </div>
        ) : !data || data.contracts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <ShieldCheck aria-hidden="true" className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">No contracts to check</p>
            <p className="text-xs text-muted-foreground">
              Compliance gates will appear when a contract is added.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {data.contracts.map((contract) => (
              <ContractCard key={contract.contractId} contract={contract} />
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-col items-start justify-between gap-3 border-t border-border pt-4 sm:flex-row sm:items-center">
          <p className="text-xs italic text-muted-foreground">
            Guardrails are guidance, not legal advice. Verify contractor status directly with the
            CSLB before releasing payment.
          </p>
          <Button
            size="sm"
            variant="outline"
            render={
              <a
                href="https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/CheckLicense.aspx"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Verify contractor license with CSLB (opens in a new tab)"
              />
            }
          >
            Verify with CSLB
            <ExternalLink aria-hidden="true" data-icon="inline-end" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default ComplianceTab;
