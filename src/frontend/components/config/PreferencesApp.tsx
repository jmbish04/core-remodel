/**
 * @fileoverview Device Preferences — config island.
 *
 * Sets this DEVICE's default landing page: where the app root (`/`) redirects to
 * when you open `core-remodel.hacolby.workers.dev` while signed in. The choice is
 * stored in a per-device cookie (`remodel_landing`), so each device is
 * independent — a Tesla can land on the drive list, a phone on the showroom
 * directory. The Worker reads that cookie at the root and 302s an authed device
 * to the chosen path (see `src/_worker.ts`).
 *
 * Cookie-only by design: no account/server state, just this browser. Clearing
 * cookies (or choosing "Home") resets to no auto-redirect.
 *
 * Monolith rules: dark theme, theme tokens only, no 1px borders.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, MapPinned } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const COOKIE = "remodel_landing";
const HOME = "__home__";
const CUSTOM = "__custom__";

/** Curated landing destinations. `value` is the in-app path stored in the cookie. */
const OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "/admin/shopping/drives", label: "Showroom Drives" },
  { value: "/admin/shopping/showrooms", label: "Showroom Directory" },
  { value: "/admin/shopping", label: "Shopping" },
  { value: "/admin/shopping/wishlist", label: "Wishlist" },
  { value: "/admin/budget/dashboard", label: "Budget Dashboard" },
  { value: "/admin/plans", label: "Plans" },
  { value: "/admin/tasks", label: "Tasks" },
  { value: "/admin/inbox", label: "Inbox" },
];

/** Same guard the Worker applies before redirecting — absolute in-app path only,
 * never the login page. Mirrors `isSafeInternalPath` in backend/utils/access.ts. */
function isSafeInternalPath(path: string): boolean {
  const normalized = path.replace(/\/$/, "");
  return (
    path.startsWith("/") &&
    !path.startsWith("//") &&
    normalized !== "/access" &&
    /^\/[A-Za-z0-9/_-]*$/.test(path)
  );
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  if (!match) return null;
  // A malformed percent-encoding would throw — fall back to the raw value.
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function writeCookie(name: string, value: string) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  // 1-year, path=/ so the Worker sees it at the root; Lax so top-level nav sends it.
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax${secure}`;
}

function clearCookie(name: string) {
  document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
}

export function PreferencesApp() {
  const [choice, setChoice] = useState<string>(HOME);
  const [customPath, setCustomPath] = useState<string>("");
  const [loaded, setLoaded] = useState(false);

  // Hydrate from the current cookie.
  useEffect(() => {
    const current = readCookie(COOKIE);
    if (current && isSafeInternalPath(current)) {
      if (OPTIONS.some((o) => o.value === current)) {
        setChoice(current);
      } else {
        setChoice(CUSTOM);
        setCustomPath(current);
      }
    }
    setLoaded(true);
  }, []);

  const save = () => {
    if (choice === HOME) {
      clearCookie(COOKIE);
      toast.success("Saved — this device will open the home page.");
      return;
    }
    const path = choice === CUSTOM ? customPath.trim() : choice;
    if (!isSafeInternalPath(path) || path === "/") {
      toast.error("Enter a valid in-app path, e.g. /admin/shopping/drives");
      return;
    }
    writeCookie(COOKIE, path);
    toast.success(`Saved — this device will open ${path}`);
  };

  if (!loaded) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPinned className="size-5 text-muted-foreground" />
            Default landing page
          </CardTitle>
          <CardDescription>
            Where this device goes when you open the app root while signed in. Applies to{" "}
            <strong>this device only</strong> — set a different page on your phone, Tesla, or
            laptop. Stored in a cookie on this browser, not an account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="landing">Open the app at</Label>
            <Select value={choice} onValueChange={(v) => setChoice(v ?? HOME)}>
              <SelectTrigger id="landing" className="w-full sm:w-80">
                <SelectValue placeholder="Choose a page" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={HOME}>Home (no auto-redirect)</SelectItem>
                {OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM}>Custom path…</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {choice === CUSTOM ? (
            <div className="space-y-2">
              <Label htmlFor="custom">Custom path</Label>
              <Input
                id="custom"
                placeholder="/admin/shopping/drives"
                value={customPath}
                onChange={(e) => setCustomPath(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                An absolute in-app path starting with <code>/</code>.
              </p>
            </div>
          ) : null}
        </CardContent>
        <CardFooter className="flex justify-end border-t bg-muted/20 py-4">
          <Button onClick={save}>
            <Check className="mr-2 h-4 w-4" />
            Save for this device
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

export default PreferencesApp;
