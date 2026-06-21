/**
 * @fileoverview Seed product area definitions.
 *
 * Product areas define room → product-type taxonomy for organizing
 * what stores and products cover. Used by the ShowroomResearchAgent
 * for gap analysis ("you have no tile contractor tracked").
 */

import { storeProductAreaDef } from "../schema/showroom/product_areas";
import type { DrizzleD1Database } from "drizzle-orm/d1";

const PRODUCT_AREAS = [
  // Bathroom
  { roomName: "Bathroom", name: "Plumbing Fixtures", description: "Faucets, showerheads, valves, and hand showers" },
  { roomName: "Bathroom", name: "Vanities", description: "Bathroom vanities, cabinets, and vessel sinks" },
  { roomName: "Bathroom", name: "Toilets", description: "Toilets, bidets, and wall-mount fixtures" },
  { roomName: "Bathroom", name: "Steam & Shower", description: "Steam generators, shower systems, and thermal experiences" },
  { roomName: "Bathroom", name: "Shower Glass", description: "Frameless glass enclosures, panels, and hardware" },
  { roomName: "Bathroom", name: "Tile", description: "Bathroom floor and wall tile, mosaics, and accent pieces" },
  { roomName: "Bathroom", name: "Mirrors & Medicine Cabinets", description: "Vanity mirrors, medicine cabinets, and lighted mirrors" },

  // Kitchen
  { roomName: "Kitchen", name: "Cabinets", description: "Kitchen cabinetry, drawer systems, and pantry organization" },
  { roomName: "Kitchen", name: "Countertops", description: "Stone, quartz, porcelain slab, and concrete countertops" },
  { roomName: "Kitchen", name: "Sinks", description: "Kitchen sinks, prep sinks, and integrated drainboards" },
  { roomName: "Kitchen", name: "Faucets", description: "Kitchen faucets, pot fillers, and water dispensers" },
  { roomName: "Kitchen", name: "Appliances", description: "Ranges, ovens, cooktops, refrigeration, and ventilation" },
  { roomName: "Kitchen", name: "Induction Cooking", description: "InvisaCook, PITT Cooking, and flush-mount induction" },
  { roomName: "Kitchen", name: "Gas Cooking", description: "PITT gas burners and traditional gas cooktops" },
  { roomName: "Kitchen", name: "Pantry Systems", description: "Pull-out pantry, lazy susans, and pantry organization" },

  // Closet
  { roomName: "Closet", name: "Walk-in Systems", description: "Full walk-in closet systems and custom millwork" },
  { roomName: "Closet", name: "LED Integration", description: "Closet lighting, sensor-activated LEDs, and accent lighting" },
  { roomName: "Closet", name: "Custom Millwork", description: "Bespoke woodwork, built-in storage, and finish carpentry" },
  { roomName: "Closet", name: "Modular Storage", description: "IKEA PAX, Elfa, and modular closet organizer systems" },
  { roomName: "Closet", name: "Accessories", description: "Jewelry drawers, valet rods, shoe racks, and island tops" },

  // Living
  { roomName: "Living", name: "Lighting", description: "Architectural, recessed, linear, and decorative lighting" },
  { roomName: "Living", name: "Architectural Trim", description: "Crown molding, baseboards, reveals, and shadow gaps" },
  { roomName: "Living", name: "Interior Doors", description: "Frameless doors, pocket doors, barn doors, and panel doors" },
  { roomName: "Living", name: "Exterior Doors", description: "Entry doors, pivot doors, and bifolding glass walls" },

  // Exterior
  { roomName: "Exterior", name: "Windows", description: "Replacement windows, skylights, and curtain walls" },
  { roomName: "Exterior", name: "Patio Doors", description: "Sliding glass doors, French doors, and multi-slide systems" },
  { roomName: "Exterior", name: "Decking & Pavers", description: "Wood decking, porcelain pavers, and pedestal systems" },
  { roomName: "Exterior", name: "Landscaping", description: "Hardscaping, corten steel, planters, and outdoor structures" },
  { roomName: "Exterior", name: "Fire Features", description: "Gas fire pits, fireplaces, and outdoor heating" },

  // General / Multi-Room
  { roomName: "General", name: "Microcement", description: "Seamless microcement coatings for floors, walls, and wet areas" },
  { roomName: "General", name: "Concrete", description: "Precast concrete sinks, countertops, and architectural elements" },
  { roomName: "General", name: "Drywall Reveals", description: "Flush drywall reveals, shadow gaps, and concealed transitions" },
  { roomName: "General", name: "Flooring", description: "Hardwood, engineered wood, LVP, and specialty flooring" },
  { roomName: "General", name: "Water Filtration", description: "Whole-home and point-of-use water filtration systems" },
  { roomName: "General", name: "Smart Home", description: "Home automation, smart switches, and integrated controls" },
] as const;

export async function seedProductAreas(db: DrizzleD1Database) {
  console.log(`Seeding ${PRODUCT_AREAS.length} product area definitions...`);

  for (const area of PRODUCT_AREAS) {
    await db
      .insert(storeProductAreaDef)
      .values({ ...area, isActive: true })
      .onConflictDoNothing();
  }

  console.log("✅ Product areas seeded.");
}

export { PRODUCT_AREAS as PRODUCT_AREAS_DATA };
