/**
 * @fileoverview Seed showroom stores from showroom_research.md.
 *
 * Each row = one physical location. Multi-location brands (e.g., Studio Belmont)
 * get separate rows per showroom. Includes closet manufacturers from
 * custom-closets.html.
 *
 * Expects store_bayarea_cities to be seeded first (city lookups via name).
 */

import { showroomStores } from "../schema/showroom/stores";
import { showroomStoreLinks } from "../schema/showroom/links";
import { storeBayareaCities } from "../schema/showroom/bay_area_cities";
import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

type StoreRow = typeof showroomStores.$inferInsert;
// `websiteUrl` is not a showroom_stores column anymore (moved to
// showroom_store_links); kept here as seed-only input, split off before insert.
type SeedStoreRow = Omit<StoreRow, "id" | "createdAt" | "updatedAt" | "bayAreaCityId"> & {
  websiteUrl?: string;
};

/**
 * Resolve a city name to its ID, returning null if not found.
 */
async function cityId(
  db: DrizzleD1Database,
  name: string
): Promise<number | null> {
  const [city] = await db
    .select({ id: storeBayareaCities.id })
    .from(storeBayareaCities)
    .where(eq(storeBayareaCities.bayAreaCityName, name))
    .limit(1);
  return city?.id ?? null;
}

/**
 * Full store catalog sourced from:
 *   - docs/0001_showroom_planner/showroom_research.md
 *   - proofs/research_app/custom-closets.html
 *
 * Fields left null will be populated by the ShowroomResearchAgent on first run.
 */
function getStoreData(): SeedStoreRow[] {
  return [
    // ── Hub C: Peninsula ──────────────────────────────────────────────
    {
      name: "Whole Wood",
      description: "San Carlos whole-wood flooring hub. Massive selection of engineered and solid hardwoods, specialty imports, and eco-certified lines.",
      pricePoint: "$$$",
      locationAddress: "San Carlos, CA",
      websiteUrl: "https://www.wholewood.com",
      isFlagshipLocation: true,
      scale: "Massive warehouse with wide range of variations",
      inventoryFocus: "Engineered hardwood, solid hardwood, European imports, reclaimed wood",
      targetDemographic: "Homeowners doing full-floor renovations, architects specifying hardwood throughout",
    },
    {
      name: "Argonaut Window & Door",
      description: "Premium window and door showroom. Authorized Marvin and Andersen dealer with full-size operating samples.",
      pricePoint: "$$$$",
      locationAddress: "San Carlos, CA",
      isFlagshipLocation: true,
      scale: "Medium showroom with comprehensive window/door vignettes",
      inventoryFocus: "Marvin, Andersen, and specialty window systems",
      targetDemographic: "Architects, general contractors, high-end residential renovations",
    },
    {
      name: "Pacific Sash & Design",
      description: "Specialty wood and aluminum-clad windows. Custom sizing and historic restoration.",
      pricePoint: "$$$$",
      locationAddress: "San Carlos, CA",
      isFlagshipLocation: true,
      scale: "Curated showroom with custom order focus",
      inventoryFocus: "Custom-sized windows, historic sash replacement, aluminum-clad systems",
      targetDemographic: "Historic home renovators, Victorian restoration projects, custom new builds",
    },
    {
      name: "Wedlock Windows",
      description: "Value-oriented window replacement. Vinyl and fiberglass frames with quick turnaround.",
      pricePoint: "$$",
      locationAddress: "San Carlos, CA",
      isFlagshipLocation: true,
      scale: "Lean operation focused on volume replacements",
      inventoryFocus: "Vinyl replacement windows, fiberglass frames, energy-efficient glazing",
      targetDemographic: "Budget-conscious homeowners, multi-unit property managers",
    },
    {
      name: "California Closets",
      description: "National custom closet franchise. San Carlos showroom with full walk-in vignettes.",
      pricePoint: "$$$",
      locationAddress: "San Carlos, CA",
      isFlagshipLocation: false,
      scale: "Medium showroom with multiple walk-in displays",
      inventoryFocus: "Custom closet systems, home office, garage storage, pantry solutions",
      targetDemographic: "Homeowners seeking turnkey closet solutions, real estate staging",
    },

    // ── Hub C: Belmont ────────────────────────────────────────────────
    {
      name: "Studio Belmont (Flagship)",
      description: "Massive, dual-wing facility. Largest comprehensive display of all brands, valves, and technical systems. Separate plumbing/hardware sides.",
      pricePoint: "$$$$",
      locationAddress: "Belmont, CA",
      isFlagshipLocation: true,
      scale: "Massive, dual-wing facility (separate plumbing/hardware sides)",
      inventoryFocus: "Largest comprehensive display of all brands, valves, and technical systems",
      targetDemographic: "Architects, interior designers, general contractors, high-end homeowners",
    },

    // ── Hub A: SF Design District ─────────────────────────────────────
    {
      name: "Studio Belmont (SF)",
      description: "San Francisco Design District location. Focuses on statement pieces and European luxury.",
      pricePoint: "$$$$",
      locationAddress: "San Francisco, CA",
      isFlagshipLocation: false,
      scale: "Highly curated boutique",
      inventoryFocus: "Focuses on statement pieces, European luxury (THG Paris)",
      targetDemographic: "Urban architects, Pacific Heights/Nob Hill renovations",
    },
    {
      name: "Lutz Bath & Kitchen",
      description: "Ultra-luxury bath and steam showroom. SF's premier destination for thermal experience equipment.",
      pricePoint: "$$$$",
      locationAddress: "San Francisco, CA",
      websiteUrl: "https://www.lutzbathandkitchen.com",
      isFlagshipLocation: true,
      scale: "Highly curated boutique focused on thermal experiences",
      inventoryFocus: "Steam generators, shower systems, luxury bath fixtures, thermal wellness equipment",
      targetDemographic: "Ultra-luxury homeowners, spa-inspired bathroom renovations, wellness architects",
    },
    {
      name: "Townsend Showroom",
      description: "High-end bath and vanity showroom in SF. Curated selection of European and American luxury brands.",
      pricePoint: "$$$$",
      locationAddress: "San Francisco, CA",
      isFlagshipLocation: true,
      scale: "Medium boutique with curated vignettes",
      inventoryFocus: "Luxury vanities, vessel sinks, decorative hardware, bath accessories",
      targetDemographic: "Interior designers, high-end bath renovations, design-build firms",
    },
    {
      name: "Porcelanosa",
      description: "Spanish tile and porcelain slab manufacturer with SF showroom. Full slab displays and kitchen/bath vignettes.",
      pricePoint: "$$$$",
      locationAddress: "San Francisco, CA",
      websiteUrl: "https://www.porcelanosa.com",
      isFlagshipLocation: false,
      scale: "Large showroom with full slab gallery and room vignettes",
      inventoryFocus: "Large-format porcelain slabs, ceramic tile, kitchen/bath complete systems",
      targetDemographic: "Architects specifying porcelain slabs, modern minimalist renovations",
    },
    {
      name: "Nido Living (Rimadesio)",
      description: "Authorized Rimadesio dealer. Ultra-luxury Italian closet systems, sliding doors, and living dividers.",
      pricePoint: "$$$$",
      locationAddress: "San Francisco, CA",
      websiteUrl: "https://www.nidoliving.com",
      isFlagshipLocation: true,
      scale: "Highly curated boutique with full-room Rimadesio installations",
      inventoryFocus: "Rimadesio sliding doors, walk-in closets, glass partitions, bookcases",
      targetDemographic: "Ultra-luxury penthouse and loft conversions, modern Italian design enthusiasts",
    },
    {
      name: "Insensation Inc.",
      description: "Frameless door systems — flush-mount interior doors that disappear into walls.",
      pricePoint: "$$$$",
      locationAddress: "San Francisco, CA",
      websiteUrl: "https://www.insensation.com",
      isFlagshipLocation: true,
      scale: "Small showroom with full-scale door installations",
      inventoryFocus: "Frameless interior doors, pocket door systems, concealed hinges",
      targetDemographic: "Modern/minimalist renovations, architects seeking clean transitions",
    },
    {
      name: "Italdoors (SF)",
      description: "Italian frameless door systems. SF showroom location.",
      pricePoint: "$$$",
      locationAddress: "San Francisco, CA",
      websiteUrl: "https://www.italdoors.com",
      isFlagshipLocation: true,
      scale: "Boutique showroom with operational door samples",
      inventoryFocus: "Italian frameless doors, concealed frame systems, pivot doors",
      targetDemographic: "Modern renovations, contractors seeking European door systems",
    },
    {
      name: "Italdoors (San Bruno)",
      description: "Italian frameless door systems. San Bruno warehouse and showroom.",
      pricePoint: "$$$",
      locationAddress: "San Bruno, CA",
      isFlagshipLocation: false,
      scale: "Warehouse + showroom combined",
      inventoryFocus: "Italian frameless doors, concealed frame systems, pivot doors",
      targetDemographic: "Contractors and builders purchasing in volume",
    },
    {
      name: "Craftex Microcement",
      description: "Microcement and microconcrete coatings for floors, walls, and wet areas.",
      pricePoint: "$$$",
      locationAddress: "San Francisco, CA",
      isFlagshipLocation: true,
      scale: "Studio with sample panels and application demos",
      inventoryFocus: "Microcement coatings, microconcrete, polished plaster finishes",
      targetDemographic: "Modern/industrial renovations, seamless surface enthusiasts",
    },
    {
      name: "Archetype Lighting",
      description: "Architectural lighting studio. Recessed, linear, and decorative systems for high-end residential.",
      pricePoint: "$$$$",
      locationAddress: "San Francisco, CA",
      isFlagshipLocation: true,
      scale: "Studio-format showroom with lighting installations",
      inventoryFocus: "Architectural recessed lighting, linear LED systems, decorative fixtures",
      targetDemographic: "Architects, lighting designers, high-end residential projects",
    },
    {
      name: "Tile Tech Pavers",
      description: "Porcelain and concrete pavers for exterior decking and pedestal systems.",
      pricePoint: "$$$",
      locationAddress: "San Francisco, CA",
      isFlagshipLocation: false,
      scale: "Showroom with outdoor application samples",
      inventoryFocus: "Porcelain pavers, pedestal systems, rooftop deck solutions",
      targetDemographic: "Landscape architects, rooftop deck projects, outdoor living renovations",
    },

    // ── Hub B: Silicon Valley ─────────────────────────────────────────
    {
      name: "Studio Belmont (San Jose)",
      description: "South Bay location. Strong appliance and kitchen fixture display.",
      pricePoint: "$$$$",
      locationAddress: "San Jose, CA",
      isFlagshipLocation: false,
      scale: "Medium showroom with kitchen/bath vignettes",
      inventoryFocus: "Kitchen fixtures, appliances, and South Bay-focused product lines",
      targetDemographic: "South Bay estates, tech executives, Silicon Valley architectural firms",
    },
    {
      name: "Tredi Interiors",
      description: "Authorized InvisaCook dealer and exclusive California importer of Arrital Italian Kitchens.",
      pricePoint: "$$$$",
      locationAddress: "Santa Clara, CA",
      websiteUrl: "https://www.trediinteriors.com",
      isFlagshipLocation: true,
      scale: "Medium showroom with working InvisaCook installations",
      inventoryFocus: "InvisaCook invisible induction, Arrital Italian kitchens, integrated cooking systems",
      targetDemographic: "Tech executives, modern kitchen renovations, invisible-appliance enthusiasts",
    },
    {
      name: "Topcret (San Jose)",
      description: "Spanish microcement manufacturer. San Jose application center.",
      pricePoint: "$$$",
      locationAddress: "San Jose, CA",
      websiteUrl: "https://www.topcret.com",
      isFlagshipLocation: false,
      scale: "Application center with sample panels",
      inventoryFocus: "Topcret microcement systems, floor/wall coatings",
      targetDemographic: "Contractors and homeowners seeking seamless surfaces",
    },

    // ── Hub D: East Bay ───────────────────────────────────────────────
    {
      name: "Studio Belmont (Walnut Creek)",
      description: "East Bay location. Focused on the Contra Costa corridor.",
      pricePoint: "$$$",
      locationAddress: "Walnut Creek, CA",
      isFlagshipLocation: false,
      scale: "Medium showroom focused on plumbing and bath",
      inventoryFocus: "Plumbing fixtures, bath accessories for East Bay market",
      targetDemographic: "East Bay homeowners, Contra Costa/Lamorinda renovations",
    },
    {
      name: "Concreteworks",
      description: "Precast concrete fabricator. Custom concrete sinks, countertops, and architectural elements.",
      pricePoint: "$$$$",
      locationAddress: "Alameda, CA",
      websiteUrl: "https://www.concreteworks.com",
      isFlagshipLocation: true,
      scale: "Factory + showroom combined",
      inventoryFocus: "Precast concrete sinks, countertops, fireplace surrounds, custom architectural elements",
      targetDemographic: "Architects, interior designers, high-end custom builds",
    },
    {
      name: "America's Dream HomeWorks",
      description: "PITT Cooking and modern kitchen showroom in Emeryville.",
      pricePoint: "$$$",
      locationAddress: "Emeryville, CA",
      isFlagshipLocation: true,
      scale: "Medium showroom with working PITT Cooking installations",
      inventoryFocus: "PITT Cooking gas/induction burners, modern kitchen systems",
      targetDemographic: "Home cooks, kitchen renovators seeking flush-mount cooking",
    },
    {
      name: "Duraamen",
      description: "Microcement and epoxy flooring manufacturer. Hayward distribution center.",
      pricePoint: "$$$",
      locationAddress: "Hayward, CA",
      websiteUrl: "https://www.duraamen.com",
      isFlagshipLocation: false,
      scale: "Distribution center with sample area",
      inventoryFocus: "Microcement, epoxy flooring, self-leveling overlays",
      targetDemographic: "Flooring contractors, commercial and residential seamless surface projects",
    },

    // ── Hub E: North Bay ──────────────────────────────────────────────
    {
      name: "Studio Belmont (Novato)",
      description: "North Bay location. Serves Marin County.",
      pricePoint: "$$$",
      locationAddress: "Novato, CA",
      isFlagshipLocation: false,
      scale: "Smaller satellite showroom",
      inventoryFocus: "Plumbing fixtures and hardware for North Bay market",
      targetDemographic: "Marin County homeowners, Mill Valley/Tiburon renovations",
    },

    // ── Multi-area / Bay-wide ─────────────────────────────────────────
    {
      name: "Topcret (SF)",
      description: "Spanish microcement manufacturer. San Francisco showroom.",
      pricePoint: "$$$",
      locationAddress: "San Francisco, CA",
      websiteUrl: "https://www.topcret.com",
      isFlagshipLocation: true,
      scale: "Showroom with application demos and sample panels",
      inventoryFocus: "Topcret microcement systems, floor/wall coatings",
      targetDemographic: "SF architects and homeowners seeking European seamless surfaces",
    },
    {
      name: "Petty Masonry Inc.",
      description: "Pedestal deck systems and exterior hardscape. Serves the full Bay Area.",
      pricePoint: "$$$",
      locationAddress: "Bay Area, CA",
      isFlagshipLocation: false,
      scale: "Field operations — consultation-based, no showroom",
      inventoryFocus: "Pedestal deck systems, exterior pavers, roof deck installation",
      targetDemographic: "General contractors, landscape architects, rooftop deck projects",
    },
    {
      name: "Archatrak",
      description: "Pedestal paver and deck systems. Bay Area distribution.",
      pricePoint: "$$$",
      locationAddress: "Bay Area, CA",
      websiteUrl: "https://www.archatrak.com",
      isFlagshipLocation: false,
      scale: "Distribution/online — consultation-based",
      inventoryFocus: "Adjustable pedestal systems, porcelain pavers, rooftop deck materials",
      targetDemographic: "Architects, deck contractors, rooftop projects",
    },

    // ── Closet manufacturers from custom-closets.html ─────────────────
    {
      name: "Poliform",
      description: "Italian luxury wardrobe and closet systems. Bespoke walk-in solutions with leather-lined drawers and glass cabinetry.",
      pricePoint: "$$$$",
      locationAddress: "San Francisco, CA",
      websiteUrl: "https://www.poliform.it",
      isFlagshipLocation: false,
      scale: "Dealer showroom — full-room installations",
      inventoryFocus: "Bespoke Italian walk-in systems, leather drawers, glass cabinetry, skincare refrigeration integration",
      targetDemographic: "Ultra-luxury primary suite renovations, Italian design enthusiasts",
    },
    {
      name: "Lema",
      description: "Italian high-end wardrobe manufacturer. Modular systems with integrated lighting.",
      pricePoint: "$$$$",
      locationAddress: "San Francisco, CA",
      websiteUrl: "https://www.lemamobili.com",
      isFlagshipLocation: false,
      scale: "Dealer showroom with European walk-in displays",
      inventoryFocus: "Italian modular closet systems, integrated LED lighting, glass-front drawers",
      targetDemographic: "Ultra-luxury renovations, European aesthetic enthusiasts",
    },
    {
      name: "Avera by The Container Store",
      description: "Premium turnkey closet systems by The Container Store. Floor-to-ceiling with specialized shoe storage and LED kits.",
      pricePoint: "$$$",
      locationAddress: "San Francisco, CA",
      websiteUrl: "https://www.containerstore.com/avera",
      isFlagshipLocation: false,
      scale: "In-store boutique within Container Store",
      inventoryFocus: "Floor-to-ceiling closet systems, shoe storage specialization, integrated LED lighting kits",
      targetDemographic: "Premium-seeking homeowners wanting turnkey solutions without bespoke lead times",
    },
    {
      name: "The Container Store",
      description: "National organizer retailer. Elfa and basic closet systems.",
      pricePoint: "$$",
      locationAddress: "San Francisco, CA",
      websiteUrl: "https://www.containerstore.com",
      isFlagshipLocation: false,
      scale: "Retail store with closet section",
      inventoryFocus: "Elfa systems, basic to mid-range closet organizers, kitchen/pantry storage",
      targetDemographic: "Budget to mid-range homeowners, rental-friendly solutions",
    },
    {
      name: "IKEA PAX",
      description: "Modular PAX wardrobe system. Standard frames in 29\" and 19\" widths.",
      pricePoint: "$",
      locationAddress: "Emeryville, CA",
      websiteUrl: "https://www.ikea.com",
      isFlagshipLocation: false,
      scale: "Full retail store with extensive PAX display area",
      inventoryFocus: "PAX wardrobe frames, KOMPLEMENT interiors, lighting, modular organization",
      targetDemographic: "Budget DIY renovators, first-time homeowners, IKEA hack community",
    },
    {
      name: "Closet Factory",
      description: "Custom closet manufacturer offering Costco member benefits. 10% Shop Card rebate on installations.",
      pricePoint: "$$$",
      locationAddress: "Bay Area, CA",
      websiteUrl: "https://www.closetfactory.com",
      isFlagshipLocation: false,
      scale: "Manufacturing + consultation-based — in-home design",
      inventoryFocus: "Custom closet systems, home office, garage storage, Murphy beds",
      targetDemographic: "Costco members, homeowners seeking custom at mid-range pricing",
    },
  ];
}

export async function seedShowroomStores(db: DrizzleD1Database) {
  const stores = getStoreData();
  console.log(`Seeding ${stores.length} showroom store locations...`);

  // City name → bayAreaCityId lookup
  const cityNameMap: Record<string, number | null> = {};

  for (const store of stores) {
    // Extract city from locationAddress (format: "City, CA" or "Bay Area, CA")
    const cityName = store.locationAddress?.split(",")[0]?.trim() ?? "";

    if (!(cityName in cityNameMap)) {
      cityNameMap[cityName] = await cityId(db, cityName);
    }

    const { websiteUrl, ...storeFields } = store;
    const [inserted] = await db
      .insert(showroomStores)
      .values({
        ...storeFields,
        bayAreaCityId: cityNameMap[cityName],
      })
      .returning({ id: showroomStores.id });

    if (websiteUrl && inserted) {
      await db.insert(showroomStoreLinks).values({
        storeId: inserted.id,
        url: websiteUrl,
        type: "WEBSITE",
      });
    }
  }

  console.log("✅ Showroom stores seeded.");
}
