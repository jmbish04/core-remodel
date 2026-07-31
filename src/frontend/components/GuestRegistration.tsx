/**
 * @fileoverview GuestRegistration.tsx
 *
 * The vendor portal's "digital business card" gate (0043, P2). A vendor lands on
 * remodel.hacolby.app, and before any photos they hand over their card: first &
 * last name, email, phone, company website. On submit we POST /api/guest/register
 * (upsert by email, sets the `remodel_guest` cookie) and drop them onto the floor
 * plan. Frictionless — no password, no confirmation step. A returning email is
 * accepted silently.
 *
 * `prefillEmail` is set when arriving via a signed /welcome?t= invite link; the
 * email is filled in for them (they still complete the rest).
 */

import { ArrowRight, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const NEXT_PATH = "/floor-plan";

export function GuestRegistration({ prefillEmail = "" }: { prefillEmail?: string }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState(prefillEmail);
  const [phone, setPhone] = useState("");
  const [companyWebsiteUrl, setCompanyWebsiteUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/guest/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email, phone, companyWebsiteUrl }),
      });
      const data = (await res.json().catch(() => null)) as
        | { success?: boolean; error?: string; details?: string[] }
        | null;
      if (!res.ok || !data?.success) {
        setError(data?.details?.[0] || data?.error || "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }
      // Cookie is set; go straight to the plan. Full navigation so the gate re-runs.
      window.location.assign(NEXT_PATH);
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-[80svh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-card/80 p-6 ring-1 ring-border/60 backdrop-blur sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight">See the plans &amp; photos</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          126 Colby is a full remodel. Drop your digital business card and step inside.
        </p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="First name" required>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" required />
            </Field>
            <Field label="Last name" required>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" required />
            </Field>
          </div>
          <Field label="Email" required>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </Field>
          <Field label="Phone" required>
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" required />
          </Field>
          <Field label="Company website" required>
            <Input
              type="url"
              inputMode="url"
              placeholder="https://"
              value={companyWebsiteUrl}
              onChange={(e) => setCompanyWebsiteUrl(e.target.value)}
              autoComplete="url"
              required
            />
          </Field>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <ArrowRight className="size-4" aria-hidden="true" />
            )}
            Enter
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            We use this only to share our plans with you.
          </p>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">
        {label}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </span>
      {children}
    </label>
  );
}

export default GuestRegistration;
