/**
 * @fileoverview ResearchAgent health probe.
 *
 * Verifies that all required bindings and credentials are available
 * for the research pipeline: Gemini API, R2, Vectorize, Workers AI.
 */

export interface HealthProbeResult {
  status: "ok" | "fail";
  latencyMs: number;
  error?: string;
  details: {
    geminiApiKey: boolean;
    cloudflareAccountId: boolean;
    r2Bucket: boolean;
    vectorize: boolean;
    workersAi: boolean;
  };
}

export async function runHealthProbe(env: Env): Promise<HealthProbeResult> {
  const start = Date.now();
  const issues: string[] = [];
  const details = {
    geminiApiKey: false,
    cloudflareAccountId: false,
    r2Bucket: false,
    vectorize: false,
    workersAi: false,
  };

  // Check GEMINI_API_KEY
  try {
    const key = await env.GEMINI_API_KEY.get();
    details.geminiApiKey = !!key;
    if (!key) issues.push("GEMINI_API_KEY not set");
  } catch {
    issues.push("Failed to read GEMINI_API_KEY");
  }

  // Check CLOUDFLARE_ACCOUNT_ID
  try {
    const accountId = await env.CLOUDFLARE_ACCOUNT_ID.get();
    details.cloudflareAccountId = !!accountId;
    if (!accountId) issues.push("CLOUDFLARE_ACCOUNT_ID not set");
  } catch {
    issues.push("Failed to read CLOUDFLARE_ACCOUNT_ID");
  }

  // Check R2 bucket binding
  try {
    details.r2Bucket = !!env.ARTIFACTS_BUCKET;
    if (!env.ARTIFACTS_BUCKET) issues.push("ARTIFACTS_BUCKET binding missing");
  } catch {
    issues.push("Failed to access ARTIFACTS_BUCKET");
  }

  // Check Vectorize binding
  try {
    details.vectorize = !!env.RESEARCH_INDEX;
    if (!env.RESEARCH_INDEX) issues.push("RESEARCH_INDEX binding missing");
  } catch {
    issues.push("Failed to access RESEARCH_INDEX");
  }

  // Check Workers AI binding
  try {
    details.workersAi = !!env.AI;
    if (!env.AI) issues.push("AI binding missing");
  } catch {
    issues.push("Failed to access AI binding");
  }

  return {
    status: issues.length === 0 ? "ok" : "fail",
    latencyMs: Date.now() - start,
    error: issues.length > 0 ? issues.join("; ") : undefined,
    details,
  };
}
