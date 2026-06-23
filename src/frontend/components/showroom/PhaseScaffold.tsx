import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface PhaseScaffoldProps {
  /** Page title, e.g. "Materials Schedule". */
  title: string;
  /** Phase number this page is scheduled for (1-4). */
  phase: number;
  /** Source screen in the Showroom Suite design portfolio. */
  source?: string;
  /** One- or two-line statement of what this page is for. */
  purpose: string;
  /** Ordered implementation steps still to build. */
  steps: string[];
  /** Optional back-link target. */
  backHref?: string;
  backLabel?: string;
}

/**
 * Build-plan placeholder for a Showroom Suite page that has been wired into the
 * nav but not yet implemented. Renders a single shadcn Card with a phase badge,
 * a purpose statement, and the numbered implementation checklist so whoever
 * opens the route sees exactly what is left to build.
 */
export function PhaseScaffold({
  title,
  phase,
  source,
  purpose,
  steps,
  backHref = "/admin/showroom",
  backLabel = "Showroom Dashboard",
}: PhaseScaffoldProps) {
  return (
    <main className="container mx-auto max-w-4xl px-4 py-10">
      <a
        href={backHref}
        className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground"
      >
        ← {backLabel}
      </a>

      <Card className="mt-6">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="font-mono uppercase tracking-widest">
              Phase {phase}
            </Badge>
            <Badge variant="outline" className="font-mono uppercase tracking-widest">
              Not yet built
            </Badge>
            {source ? (
              <Badge variant="ghost" className="font-mono uppercase tracking-widest text-muted-foreground">
                Source · {source}
              </Badge>
            ) : null}
          </div>
          <CardTitle className="mt-3 text-2xl">{title}</CardTitle>
          <CardDescription className="text-base leading-relaxed">
            {purpose}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <h2 className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Tasks
          </h2>
          <ol className="mt-3 space-y-3">
            {steps.map((step, index) => (
              <li key={index} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-mono text-muted-foreground">
                  {index + 1}
                </span>
                <span className="text-sm leading-relaxed text-foreground">{step}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </main>
  );
}
