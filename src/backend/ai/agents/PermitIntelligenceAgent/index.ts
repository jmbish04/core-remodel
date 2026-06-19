import { Agent, callable } from "agents";
import { drizzle } from "drizzle-orm/d1";
import { permitsContactActivity, permitsContactInsights, permitsContacts } from "@backend/db";
import { eq } from "drizzle-orm";

export class PermitIntelligenceAgent extends Agent<Env> {
  @callable()
  async runIntelligence(contactName: string) {
    try {
      console.log(`Starting Permit Intelligence for ${contactName}`);

      // 1. Generate variations using AI
      const variations = await this.generateNameVariations(contactName);
      console.log(`Generated variations:`, variations);

      // 2. Fetch permits for these variations from SODA
      // SF DBI Building Permits: i98e-dtt9
      const permits = await this.fetchPermitsForVariations(variations);

      // 3. Store into DB
      await this.saveActivity(contactName, permits);

      // 4. Generate Insights
      await this.generateInsights(contactName, permits);

      console.log(`Finished Permit Intelligence for ${contactName}`);
    } catch (error) {
      console.error(`Failed to run permit intelligence for ${contactName}`, error);
    }
  }

  private async generateNameVariations(baseName: string): Promise<string[]> {
    const prompt = `Generate a JSON array of 3-5 search variations for the construction contractor name "${baseName}".
Include common abbreviations (e.g., "Bros" for "Brothers", "Inc", "LLC") and common misspellings or partial names used in public permit filings.
Return ONLY a valid JSON array of strings, nothing else.`;

    const res = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 200,
    });

    try {
      const text = (res as any).response || "";
      const match = text.match(/\[.*\]/s);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) {
          // ensure baseName is always in there
          return Array.from(new Set([baseName, ...parsed])).filter(Boolean);
        }
      }
    } catch (e) {
      console.error("Failed to parse variations", e);
    }
    return [baseName];
  }

  private async fetchPermitsForVariations(variations: string[]) {
    // SODA API for Building Permits: i98e-dtt9
    // We'll search the full text `$q` for each variation
    const datasetId = "i98e-dtt9";
    const allPermits = [];
    const seen = new Set();

    for (const variant of variations) {
      const url = new URL(`https://data.sfgov.org/resource/${datasetId}.json`);
      url.searchParams.set("$q", variant);
      url.searchParams.set("$order", ":id DESC");
      url.searchParams.set("$limit", "200");

      const res = await fetch(url.toString(), {
        headers: { "X-App-Token": this.env.SODA_APP_TOKEN || "" }
      });

      if (!res.ok) continue;
      const rows: any[] = await res.json();

      for (const row of rows) {
        const permitNo = row.permit_number || row.application_number || row.permit;
        if (!permitNo) continue;
        
        // Simple heuristic to ensure it's actually matching the contractor/applicant name
        // SF DBI fields vary, but common ones are contractor_name, applicant_name
        const cName = String(row.contractor_name || row.applicant_name || "").toLowerCase();
        const vName = variant.toLowerCase();
        
        // If the variant isn't in the contractor or applicant name, skip (it might have matched an address)
        if (!cName.includes(vName)) continue;

        if (!seen.has(permitNo)) {
          seen.add(permitNo);
          allPermits.push(row);
        }
      }
    }

    return allPermits;
  }

  private async saveActivity(contactName: string, permits: any[]) {
    const db = drizzle(this.env.DB);
    
    // Ensure the contact is in permitsContacts so it shows up in dashboard
    await db.insert(permitsContacts)
      .values({
        contactName,
        isMonitored: true,
        activePropertyPermitCount: 0,
        closedPropertyPermitCount: 0,
        metadata: JSON.stringify({ source: "Bid Portfolio Manual Addition" })
      })
      .onConflictDoNothing()
      .run();

    // Clear old
    await db.delete(permitsContactActivity)
      .where(eq(permitsContactActivity.contactName, contactName))
      .run();

    // Insert new
    for (const permit of permits) {
      const status = (permit.permit_status || permit.status || "").toLowerCase();
      let category = "other";
      if (status.includes("complete") || status.includes("closed")) category = "completed";
      else if (status.includes("issued") || status.includes("approved")) category = "in_progress";
      else if (status.includes("filed") || status.includes("pending")) category = "pending";

      await db.insert(permitsContactActivity).values({
        id: crypto.randomUUID(),
        contactName,
        dataset: "i98e-dtt9",
        recordKey: permit.permit_number || permit.application_number || crypto.randomUUID(),
        permitNumber: permit.permit_number,
        permitType: permit.permit_type_definition || "Building",
        permitStatus: permit.permit_status || "Unknown",
        statusCategory: category,
        propertyAddress: permit.street_address || permit.address,
        issuedDate: permit.issued_date,
        closedDate: permit.completed_date,
        latitude: permit.location?.latitude || permit.latitude,
        longitude: permit.location?.longitude || permit.longitude,
        rawData: JSON.stringify(permit)
      }).run();
    }
  }

  private async generateInsights(contactName: string, permits: any[]) {
    const db = drizzle(this.env.DB);
    
    let active = 0;
    let completed = 0;
    for (const p of permits) {
      const s = (p.permit_status || "").toLowerCase();
      if (s.includes("complete") || s.includes("closed")) completed++;
      else active++;
    }

    const prompt = `Analyze this contractor's workload based on SF DBI records:
Name: ${contactName}
Active Permits: ${active}
Completed Permits: ${completed}
Return a strict JSON with: riskLevel (low, medium, high), summary (1-2 sentences), highlights (array of 3 short bullet points).`;

    const res = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        { role: "system", content: "You output JSON only." },
        { role: "user", content: prompt }
      ],
      max_tokens: 300,
    });

    let riskLevel = "medium";
    let summary = "Workload analyzed.";
    let highlights = [`Active permits: ${active}`, `Completed permits: ${completed}`];

    try {
      const text = (res as any).response || "";
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        riskLevel = parsed.riskLevel || riskLevel;
        summary = parsed.summary || summary;
        highlights = parsed.highlights || highlights;
      }
    } catch (e) {
      console.error("Failed to parse insight", e);
    }

    await db.insert(permitsContactInsights)
      .values({
        id: crypto.randomUUID(),
        contactName,
        riskLevel,
        summary,
        highlights: JSON.stringify(highlights),
        metrics: JSON.stringify({ openCount: active, completedCount: completed }),
        model: "@cf/meta/llama-3.1-8b-instruct",
      })
      .onConflictDoUpdate({
        target: permitsContactInsights.contactName,
        set: {
          riskLevel,
          summary,
          highlights: JSON.stringify(highlights),
          metrics: JSON.stringify({ openCount: active, completedCount: completed }),
        }
      })
      .run();
  }
}
