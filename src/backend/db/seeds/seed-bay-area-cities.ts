/**
 * @fileoverview Seed Bay Area cities with hub route classification.
 *
 * Usage (via Drizzle Studio or script runner):
 *   Import this file and call seedBayAreaCities(db).
 *
 * Hub Routes:
 *   A = SF Design District (ultra-luxury core)
 *   B = Silicon Valley & South Bay
 *   C = Peninsula / Mid-Market
 *   D = East Bay (fabrication, manufacturing, raw materials)
 *   E = North Bay (specialty & trade)
 */

import { storeBayareaCities } from "../schema/showroom/bay_area_cities";
import type { DrizzleD1Database } from "drizzle-orm/d1";

const CITIES = [
  // Hub A: SF Design District
  { bayAreaCityName: "San Francisco", distanceFromSanFrancisco: "0 mi", hubRoute: "A", hubName: "SF Design District" },

  // Hub B: Silicon Valley & South Bay
  { bayAreaCityName: "San Jose", distanceFromSanFrancisco: "48 mi", hubRoute: "B", hubName: "Silicon Valley & South Bay" },
  { bayAreaCityName: "Santa Clara", distanceFromSanFrancisco: "44 mi", hubRoute: "B", hubName: "Silicon Valley & South Bay" },
  { bayAreaCityName: "Menlo Park", distanceFromSanFrancisco: "32 mi", hubRoute: "B", hubName: "Silicon Valley & South Bay" },
  { bayAreaCityName: "Palo Alto", distanceFromSanFrancisco: "33 mi", hubRoute: "B", hubName: "Silicon Valley & South Bay" },

  // Hub C: Peninsula / Mid-Market
  { bayAreaCityName: "San Carlos", distanceFromSanFrancisco: "27 mi", hubRoute: "C", hubName: "Peninsula / Mid-Market" },
  { bayAreaCityName: "Belmont", distanceFromSanFrancisco: "24 mi", hubRoute: "C", hubName: "Peninsula / Mid-Market" },
  { bayAreaCityName: "San Mateo", distanceFromSanFrancisco: "20 mi", hubRoute: "C", hubName: "Peninsula / Mid-Market" },
  { bayAreaCityName: "Redwood City", distanceFromSanFrancisco: "26 mi", hubRoute: "C", hubName: "Peninsula / Mid-Market" },
  { bayAreaCityName: "San Bruno", distanceFromSanFrancisco: "12 mi", hubRoute: "C", hubName: "Peninsula / Mid-Market" },

  // Hub D: East Bay
  { bayAreaCityName: "Oakland", distanceFromSanFrancisco: "12 mi", hubRoute: "D", hubName: "East Bay" },
  { bayAreaCityName: "Berkeley", distanceFromSanFrancisco: "13 mi", hubRoute: "D", hubName: "East Bay" },
  { bayAreaCityName: "Emeryville", distanceFromSanFrancisco: "11 mi", hubRoute: "D", hubName: "East Bay" },
  { bayAreaCityName: "Alameda", distanceFromSanFrancisco: "14 mi", hubRoute: "D", hubName: "East Bay" },
  { bayAreaCityName: "Hayward", distanceFromSanFrancisco: "25 mi", hubRoute: "D", hubName: "East Bay" },
  { bayAreaCityName: "Fremont", distanceFromSanFrancisco: "36 mi", hubRoute: "D", hubName: "East Bay" },
  { bayAreaCityName: "Dublin", distanceFromSanFrancisco: "37 mi", hubRoute: "D", hubName: "East Bay" },
  { bayAreaCityName: "Walnut Creek", distanceFromSanFrancisco: "25 mi", hubRoute: "D", hubName: "East Bay" },
  { bayAreaCityName: "San Leandro", distanceFromSanFrancisco: "18 mi", hubRoute: "D", hubName: "East Bay" },

  // Hub E: North Bay
  { bayAreaCityName: "Novato", distanceFromSanFrancisco: "30 mi", hubRoute: "E", hubName: "North Bay" },
  { bayAreaCityName: "Mill Valley", distanceFromSanFrancisco: "15 mi", hubRoute: "E", hubName: "North Bay" },
  { bayAreaCityName: "San Rafael", distanceFromSanFrancisco: "18 mi", hubRoute: "E", hubName: "North Bay" },
  { bayAreaCityName: "Sausalito", distanceFromSanFrancisco: "8 mi", hubRoute: "E", hubName: "North Bay" },
] as const;

export async function seedBayAreaCities(db: DrizzleD1Database) {
  console.log(`Seeding ${CITIES.length} Bay Area cities...`);

  for (const city of CITIES) {
    await db
      .insert(storeBayareaCities)
      .values(city)
      .onConflictDoNothing();
  }

  console.log("✅ Bay Area cities seeded.");
}

/** Export raw data for use in other seed scripts. */
export { CITIES as BAY_AREA_CITIES_DATA };
