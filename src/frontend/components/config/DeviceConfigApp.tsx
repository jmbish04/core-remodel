/**
 * @fileoverview Device — config page (`/admin/config/device`).
 *
 * Sets THIS device's default landing page: where the app root (`/`) redirects to
 * when this device opens the app while signed in. Device = the `remodel_device`
 * cookie; the choice is stored in D1 (`device_preferences`) and read by the
 * Worker at the root. So a Tesla lands on the drive list, a phone on showrooms.
 *
 * Landing options render as full-width, single-column cards grouped exactly like
 * the main sidebar (public groups always; admin groups only when authenticated).
 * Clicking a card makes it active in the database; the active card is highlighted
 * on load (default: Home / no redirect).
 *
 * Monolith rules: dark theme, tokens only, no 1px borders.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ADMIN_NAV_GROUPS, PUBLIC_NAV_GROUPS } from "@/components/sidebar/nav-groups";
import type { NavGroupDef } from "@/components/sidebar/shared";
import { ConfigShell } from "./ConfigShell";

/** Optional one-line descriptions per landing target (keyed by href). */
const DESCRIPTIONS: Record<string, string> = {
  "/admin/shopping/drives": "Planned showroom-visit drive sheets with completion progress.",
  "/admin/shopping/showrooms": "The showroom directory.",
  "/admin/shopping": "Sourcing & shopping tools hub.",
  "/admin/budget/tracker": "Line-item budget tracker.",
  "/admin/tasks": "Task list.",
  "/admin/inbox": "Email inbox.",
  "/floor-plan": "Interactive home floor plan.",
  "/photos/listing": "Listing photo gallery.",
};

const HOME = "__home__";

export function DeviceConfigApp() {
  const [active, setActive] = useState<string>(HOME);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/config/device", { credentials: "include" });
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        const data = (await res.json()) as { landingPath: string | null; isAdmin: boolean };
        if (!on) return;
        setActive(data.landingPath ?? HOME);
        setIsAdmin(Boolean(data.isAdmin));
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        if (on) setLoading(false);
      }
    })();
    return () => {
      on = false;
    };
  }, []);

  const choose = async (href: string) => {
    const landingPath = href === HOME ? null : href;
    setSaving(href);
    const prev = active;
    setActive(href); // optimistic
    try {
      const res = await fetch("/api/admin/config/device", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ landingPath }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      toast.success(landingPath ? `This device now opens ${landingPath}` : "This device opens Home");
    } catch (e) {
      setActive(prev); // revert
      toast.error((e as Error).message);
    } finally {
      setSaving(null);
    }
  };

  const optionCard = (href: string, label: string, description?: string) => {
    const isActive = active === href;
    return (
      <button
        key={href}
        type="button"
        onClick={() => choose(href)}
        disabled={saving !== null}
        className="w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
        aria-pressed={isActive}
      >
        <Card className={cn("w-full transition-colors", isActive ? "border-primary bg-primary/5" : "hover:bg-card/80")}>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{label}</p>
              {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
              <p className="mt-0.5 truncate text-xs text-muted-foreground/70">
                {href === HOME ? "/" : href}
              </p>
            </div>
            {saving === href ? (
              <Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" />
            ) : isActive ? (
              <Check className="size-5 shrink-0 text-primary" strokeWidth={3} />
            ) : null}
          </CardContent>
        </Card>
      </button>
    );
  };

  const groupSection = (heading: string, groups: NavGroupDef[]) => (
    <section className="space-y-4">
      <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{heading}</h2>
      {groups.map((g) => (
        <div key={g.id} className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground/70">{g.label}</p>
          <div className="space-y-2">
            {g.items
              .filter((i) => i.href.startsWith("/"))
              .map((i) => optionCard(i.href, i.label, DESCRIPTIONS[i.href]))}
          </div>
        </div>
      ))}
    </section>
  );

  return (
    <ConfigShell
      activeHref="/admin/config/device"
      title="Device"
      description="Set this device's default landing page. Applies to this device only — the choice is remembered by a cookie on this browser and stored per device."
    >
      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="max-w-2xl space-y-8">
          <section className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Default</h2>
            {optionCard(HOME, "Home (no auto-redirect)", "Open the normal home page.")}
          </section>

          {groupSection("Public pages", PUBLIC_NAV_GROUPS)}
          {isAdmin ? groupSection("Admin pages", ADMIN_NAV_GROUPS) : null}
        </div>
      )}
    </ConfigShell>
  );
}

export default DeviceConfigApp;
