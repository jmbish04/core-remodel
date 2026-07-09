/**
 * @fileoverview AdminIntegrationsUsageApp — read-only usage monitor for the
 * Admin · Integrations surface. Tabs across the three metered integrations:
 *
 *   • Google Maps  — Places/Routes free-tier quota (GET /usage)
 *   • Gemini       — first-party token ledger (GET /gemini, from gemini_usage_log)
 *   • AI Gateway   — request analytics for Workers AI / Replicate / Fal
 *                    (GET /ai-gateway, best-effort via CF GraphQL analytics)
 *
 * Each tab is a self-contained, self-fetching section (see ./usage/*). No
 * billing block, no mutations, no mock data — every number comes from
 * /api/admin/integrations/*.
 */

import { Layers } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MapsUsageSection } from "./usage/MapsUsageSection";
import { GeminiUsageSection } from "./usage/GeminiUsageSection";
import { AiGatewayUsageSection } from "./usage/AiGatewayUsageSection";

export function AdminIntegrationsUsageApp() {
  return (
    <main className="container mx-auto max-w-5xl px-4 py-10">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Layers className="size-4" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">Integrations · Usage</h1>
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Monthly usage across metered integrations — Maps quota, Gemini tokens, and AI Gateway traffic.
        </p>
      </div>

      <Tabs defaultValue="gemini" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="gemini">Gemini</TabsTrigger>
          <TabsTrigger value="ai-gateway">AI Gateway</TabsTrigger>
          <TabsTrigger value="maps">Google Maps</TabsTrigger>
        </TabsList>

        {/* Gemini first — it's the primary spend-reconciliation surface. */}
        <TabsContent value="gemini">
          <GeminiUsageSection />
        </TabsContent>
        <TabsContent value="ai-gateway">
          <AiGatewayUsageSection />
        </TabsContent>
        <TabsContent value="maps">
          <MapsUsageSection />
        </TabsContent>
      </Tabs>
    </main>
  );
}
