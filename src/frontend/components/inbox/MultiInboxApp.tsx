import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InboxApp } from "@/components/inbox/InboxApp";
import { GmailInboxApp } from "@/components/gmail/GmailInboxApp";

/**
 * Unified inbox — one page across every email integration. Tabs mount the
 * existing per-integration apps unchanged (worker-email HITL + Gmail comms).
 * ponytail: thin wrapper, add a real merged/threaded feed only if asked.
 */
export function MultiInboxApp() {
  return (
    <Tabs defaultValue="worker" className="w-full">
      <TabsList className="mb-4">
        <TabsTrigger value="worker">Worker Email</TabsTrigger>
        <TabsTrigger value="gmail">Gmail</TabsTrigger>
      </TabsList>
      <TabsContent value="worker">
        <InboxApp />
      </TabsContent>
      <TabsContent value="gmail">
        <GmailInboxApp />
      </TabsContent>
    </Tabs>
  );
}
