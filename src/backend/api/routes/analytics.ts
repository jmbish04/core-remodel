import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { dashboardAnalyticsJobs } from "@backend/db";
import { eq, sql } from "drizzle-orm";

const analyticsRouter = new Hono<{ Bindings: Env }>();

// Predefined mock Bay Area jobs for seeding
const MOCK_JOBS = [
  { jobTitle: "Full Kitchen Renovation", category: "Kitchen", region: "San Francisco", latitude: 37.7749, longitude: -122.4194, bidAmount: 85000, keywords: "cabinet,quartz,plumbing,lighting" },
  { jobTitle: "Modern Kitchen Face-lift", category: "Kitchen", region: "East Bay", latitude: 37.8044, longitude: -122.2712, bidAmount: 42000, keywords: "island,paint,sink,backsplash" },
  { jobTitle: "High-End Chef Kitchen", category: "Kitchen", region: "South Bay", latitude: 37.3382, longitude: -121.8863, bidAmount: 125000, keywords: "appliances,marble,ventilation,gas" },
  { jobTitle: "Compact Condo Kitchen", category: "Kitchen", region: "North Bay", latitude: 37.9735, longitude: -122.5311, bidAmount: 32000, keywords: "efficient,shelving,laminate" },

  { jobTitle: "Master Shower & Bath Remodel", category: "Bathroom", region: "San Francisco", latitude: 37.7650, longitude: -122.4400, bidAmount: 28000, keywords: "tile,glass,tub,drain" },
  { jobTitle: "Guest Powder Room Update", category: "Bathroom", region: "East Bay", latitude: 37.8715, longitude: -122.2730, bidAmount: 12000, keywords: "vanity,toilet,mirror,faucet" },
  { jobTitle: "Steam Shower Installation", category: "Bathroom", region: "South Bay", latitude: 37.3688, longitude: -122.0363, bidAmount: 45000, keywords: "steam,bench,tile,waterproofing" },
  { jobTitle: "Shower Pan & Drain Repair", category: "Bathroom", region: "North Bay", latitude: 38.0100, longitude: -122.5800, bidAmount: 8500, keywords: "drain,slope,pan,epoxy" },

  { jobTitle: "Whole House Drywall & Tape", category: "Drywall", region: "San Francisco", latitude: 37.7300, longitude: -122.4000, bidAmount: 18000, keywords: "sheetrock,mudding,texture,sanding" },
  { jobTitle: "Basement Drywall Sheetrocking", category: "Drywall", region: "East Bay", latitude: 37.8200, longitude: -122.2500, bidAmount: 9500, keywords: "moisture-resistant,framing,tape" },
  { jobTitle: "Garage Drywall Finish", category: "Drywall", region: "South Bay", latitude: 37.3200, longitude: -121.9000, bidAmount: 6200, keywords: "fire-code,mudding,sanding" },
  
  { jobTitle: "HVAC Ductwork & Smart Thermostat", category: "HVAC", region: "San Francisco", latitude: 37.7800, longitude: -122.4300, bidAmount: 22000, keywords: "ducts,smart-controls,filter,hepa" },
  { jobTitle: "Central AC Installation", category: "HVAC", region: "East Bay", latitude: 37.8300, longitude: -122.2800, bidAmount: 16500, keywords: "compressor,coolant,electrical,line" },
  { jobTitle: "Heat Pump System Integration", category: "HVAC", region: "South Bay", latitude: 37.4000, longitude: -121.9500, bidAmount: 29000, keywords: "heat-pump,efficiency,inverter" }
];

/**
 * Helper to ensure the analytics database is seeded with mock data.
 */
async function ensureSeeded(db: any) {
  const countRes = await db.select({ count: sql<number>`count(*)` }).from(dashboardAnalyticsJobs).all();
  if (countRes[0].count === 0) {
    console.log("Seeding dashboard_analytics_jobs with mock geographic Bay Area data...");
    
    // Seed initial mock jobs
    const inserts = MOCK_JOBS.map((job, idx) => ({
      id: `mock-job-${idx}-${Date.now()}`,
      jobTitle: job.jobTitle,
      category: job.category,
      region: job.region,
      latitude: job.latitude,
      longitude: job.longitude,
      bidAmount: job.bidAmount,
      keywords: job.keywords,
      timestamp: new Date(Date.now() - idx * 3600000 * 4) // Spread out over past 2 days
    }));

    for (const insert of inserts) {
      await db.insert(dashboardAnalyticsJobs).values(insert).run();
    }
  }
}

/**
 * POST /api/analytics/seed
 * Force seed the database with job analytics mock records.
 */
analyticsRouter.post("/seed", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    await ensureSeeded(db);
    return c.json({ success: true, message: "Database seeded successfully" });
  } catch (error) {
    return c.json({ error: "Failed to seed analytics table", details: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

/**
 * GET /api/analytics/map
 * Returns geographic job clusters for MapCN map widget.
 */
analyticsRouter.get("/map", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    await ensureSeeded(db);

    const jobs = await db.select().from(dashboardAnalyticsJobs).all();
    
    // Format into clusters/features for MapCN and general layout
    const features = jobs.map((job) => ({
      type: "Feature",
      properties: {
        id: job.id,
        title: job.jobTitle,
        category: job.category,
        region: job.region,
        bidAmount: job.bidAmount,
        keywords: job.keywords.split(",")
      },
      geometry: {
        type: "Point",
        coordinates: [job.longitude, job.latitude]
      }
    }));

    return c.json({
      type: "FeatureCollection",
      features
    });
  } catch (error) {
    return c.json({ error: "Failed to load map analytics data", details: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

/**
 * GET /api/analytics/live
 * Serves real-time streaming line chart.
 * Simulates a continuous timeline of construction bids being placed.
 */
analyticsRouter.get("/live", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    await ensureSeeded(db);

    const queryParams = c.req.query();
    const isLatestOnly = queryParams.latest === "true";

    if (isLatestOnly) {
      // Pick a random mock job event and generate a bid amount
      const randomBaseJob = MOCK_JOBS[Math.floor(Math.random() * MOCK_JOBS.length)];
      const randomizedValue = randomBaseJob.bidAmount * (0.8 + Math.random() * 0.4);
      return c.json({
        time: Math.floor(Date.now() / 1000),
        value: Math.round(randomizedValue),
        region: randomBaseJob.region,
        category: randomBaseJob.category
      });
    }

    // Otherwise, return a history of data points for chart initialization
    const jobs = await db.select().from(dashboardAnalyticsJobs).all();
    const sorted = [...jobs].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const dataPoints = sorted.map((job) => ({
      time: Math.floor(job.timestamp.getTime() / 1000),
      value: job.bidAmount,
      region: job.region,
      category: job.category
    }));

    return c.json(dataPoints);
  } catch (error) {
    return c.json({ error: "Failed to retrieve live data stream", details: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

/**
 * GET /api/analytics/sankey
 * Aggregates categories, regions, and keywords into a Sankey flow graph.
 */
analyticsRouter.get("/sankey", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    await ensureSeeded(db);

    const jobs = await db.select().from(dashboardAnalyticsJobs).all();

    // Node collection
    const nodeNames = new Set<string>();
    
    // Group categories, regions, and keywords
    const categoryToRegionLinks: Record<string, number> = {};
    const regionToKeywordLinks: Record<string, number> = {};

    jobs.forEach((job) => {
      nodeNames.add(job.category);
      nodeNames.add(job.region);
      
      const catRegKey = `${job.category}-->${job.region}`;
      categoryToRegionLinks[catRegKey] = (categoryToRegionLinks[catRegKey] || 0) + job.bidAmount;

      const keywordsList = job.keywords.split(",");
      keywordsList.forEach((kw) => {
        const keywordCapitalized = kw.charAt(0).toUpperCase() + kw.slice(1);
        nodeNames.add(keywordCapitalized);
        
        const regKwKey = `${job.region}-->${keywordCapitalized}`;
        regionToKeywordLinks[regKwKey] = (regionToKeywordLinks[regKwKey] || 0) + (job.bidAmount / keywordsList.length);
      });
    });

    const nodes = Array.from(nodeNames).map((name) => ({ name }));
    const nodeIndex = (name: string) => nodes.findIndex((n) => n.name === name);

    const links: { source: number; target: number; value: number }[] = [];

    // Map Level 1 (Category -> Region) links
    Object.entries(categoryToRegionLinks).forEach(([key, val]) => {
      const [src, tgt] = key.split("-->");
      const srcIdx = nodeIndex(src);
      const tgtIdx = nodeIndex(tgt);
      if (srcIdx !== -1 && tgtIdx !== -1) {
        links.push({ source: srcIdx, target: tgtIdx, value: Math.round(val) });
      }
    });

    // Map Level 2 (Region -> Keyword) links
    Object.entries(regionToKeywordLinks).forEach(([key, val]) => {
      const [src, tgt] = key.split("-->");
      const srcIdx = nodeIndex(src);
      const tgtIdx = nodeIndex(tgt);
      if (srcIdx !== -1 && tgtIdx !== -1) {
        links.push({ source: srcIdx, target: tgtIdx, value: Math.round(val) });
      }
    });

    return c.json({ nodes, links });
  } catch (error) {
    return c.json({ error: "Failed to construct Sankey flow mappings", details: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

export { analyticsRouter };
