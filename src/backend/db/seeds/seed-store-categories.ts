/**
 * @fileoverview Seed store categories extracted from showroom_research.md.
 *
 * Categories represent the primary product/service domains that showrooms
 * operate in. The ShowroomResearchAgent later refines these via
 * showroom_store_category_mapping with AI rationale + confidence scores.
 */

import { showroomStoreCategory } from "../schema/showroom/categories";
import type { DrizzleD1Database } from "drizzle-orm/d1";

const CATEGORIES = [
  { name: "Flooring", description: "Hardwood, engineered wood, tile, stone, and luxury vinyl flooring" },
  { name: "Windows & Doors", description: "Replacement windows, patio doors, entry doors, and specialty glass" },
  { name: "Plumbing & Hardware", description: "Faucets, fixtures, valves, shower systems, and decorative hardware" },
  { name: "Bath & Vanities", description: "Bathroom vanities, vessel sinks, mirrors, and bath accessories" },
  { name: "Steam & Shower Systems", description: "Steam generators, shower controls, and thermal experience equipment" },
  { name: "Tile & Porcelain", description: "Porcelain slab, ceramic tile, mosaic, and natural stone surfaces" },
  { name: "Closets & Storage", description: "Walk-in closet systems, custom millwork, modular storage, and organizational solutions" },
  { name: "Closets / Luxury", description: "High-end Italian and European bespoke closet systems (Poliform, Lema, Rimadesio)" },
  { name: "Frameless Doors", description: "Frameless interior doors, pocket doors, and concealed-frame systems" },
  { name: "Precast Concrete", description: "Architectural precast concrete countertops, sinks, vanities, and custom pieces" },
  { name: "Kitchen Cabinets & Systems", description: "Kitchen cabinetry, drawer systems, and integrated storage solutions" },
  { name: "Kitchen / InvisaCook", description: "Invisible induction cooking systems integrated under porcelain countertops" },
  { name: "Kitchen / PITT Cooking", description: "Flush-mounted gas and induction burners for seamless countertop integration" },
  { name: "Microcement & Coatings", description: "Microcement, microconcrete, polished plaster, and seamless surface coatings" },
  { name: "Architectural Lighting", description: "Recessed, linear, and decorative architectural lighting systems" },
  { name: "Decking & Pavers", description: "Outdoor decking, porcelain pavers, pedestal systems, and hardscape materials" },
  { name: "Appliances", description: "Major kitchen and laundry appliances, cooking ranges, and ventilation" },
  { name: "Countertops", description: "Natural stone, quartz, porcelain slab, and solid surface countertops" },
  { name: "Architectural Trim & Reveals", description: "Drywall reveal systems, shadow gaps, and flush baseboards (Fry Reglet, EZ Concept)" },
  { name: "Landscaping & Outdoor", description: "Outdoor living, corten steel, fire features, and landscape architecture" },
  { name: "Water Filtration", description: "Whole-home and point-of-use water filtration and purification systems" },
] as const;

export async function seedStoreCategories(db: DrizzleD1Database) {
  console.log(`Seeding ${CATEGORIES.length} store categories...`);

  for (const cat of CATEGORIES) {
    await db
      .insert(showroomStoreCategory)
      .values({ ...cat, isActive: true })
      .onConflictDoNothing();
  }

  console.log("✅ Store categories seeded.");
}

export { CATEGORIES as STORE_CATEGORIES_DATA };
