import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InboxApp } from "@/components/inbox/InboxApp";
import { GmailInboxApp } from "@/components/gmail/GmailInboxApp";

/**
 * Unified inbox — one page across every email integration. Tabs mount the
 * existing per-integration apps unchanged (worker-email HITL + Gmail comms).
 * Each app is mounted only once its tab is first opened, so we don't fire both
 * apps' initial fetches on page load.
 * ponytail: thin wrapper, add a real merged/threaded feed only if asked.
 */
export function MultiInboxApp() {
  const [tab, setTab] = useState("worker");
  const [visited, setVisited] = useState<Set<string>>(() => new Set(["worker"]));

  function onChange(v: string) {
    setTab(v);
    setVisited((s) => (s.has(v) ? s : new Set(s).add(v)));
  }

  return (
    <Tabs value={tab} onValueChange={onChange} className="w-full">
      <TabsList className="mb-4">
        <TabsTrigger value="worker">Worker Email</TabsTrigger>
        <TabsTrigger value="gmail">Gmail</TabsTrigger>
      </TabsList>
      <TabsContent value="worker">{visited.has("worker") && <InboxApp />}</TabsContent>
      <TabsContent value="gmail">{visited.has("gmail") && <GmailInboxApp />}</TabsContent>
    </Tabs>
  );
}
