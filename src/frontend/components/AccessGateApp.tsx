import { LockKeyhole, Loader2 } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function getNextPath(): string {
  if (typeof window === "undefined") {
    return "/";
  }

  const query = new URLSearchParams(window.location.search).get("next");
  if (!query || !query.startsWith("/")) {
    return "/";
  }
  return query;
}

export function AccessGateApp() {
  const [password, setPassword] = useState("");
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const nextPath = useMemo(() => getNextPath(), []);

  useEffect(() => {
    const verify = async () => {
      try {
        const response = await fetch("/api/access/status", { credentials: "include" });
        const payload = (await response.json()) as { authenticated?: boolean };

        if (response.ok && payload.authenticated) {
          window.location.assign(nextPath || "/");
          return;
        }
      } catch {
        // ignore
      } finally {
        setChecking(false);
      }
    };

    verify();
  }, [nextPath]);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!password.trim()) {
      toast.error("Enter the access password");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/access/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password.trim() }),
      });

      const payload = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Invalid password");
      }

      toast.success("Access granted");
      window.location.assign(nextPath || "/");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-md py-10">
      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <LockKeyhole className="size-5 text-muted-foreground" />
            Protected Access
          </CardTitle>
          <CardDescription>Enter the project password to open this section.</CardDescription>
        </CardHeader>
        <CardContent>
          {checking ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Checking access...
            </div>
          ) : (
            <form className="space-y-4" onSubmit={onSubmit}>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter password"
                  disabled={submitting}
                />
              </div>

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Verifying
                  </>
                ) : (
                  "Unlock"
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
