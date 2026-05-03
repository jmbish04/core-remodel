/**
 * @fileoverview Brand color extraction from company websites.
 *
 * Uses the Browser Rendering `/json` endpoint (Workers AI-powered)
 * to scrape a company's website and identify their brand colors.
 * Returns a palette with primary (darkened) and accent (direct) variants.
 */

import { extractJson } from "@/ai/tools/browser-rendering";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BrandColorPalette = {
  /** Darkened/desaturated variant — used for headings, borders, name. */
  primary: string;
  /** Direct brand color — used for target role, company names. */
  accent: string;
  /** URL that was scraped to extract colors. */
  source: string;
};

/** Default palette when extraction fails or no company is matched. */
export const DEFAULT_BRAND_COLORS: BrandColorPalette = {
  primary: "#1A365D", // Deep Navy
  accent: "#0D9488", // Premium Teal
  source: "default",
};

// ---------------------------------------------------------------------------
// Hex ↔ HSL color utilities (zero-dependency, Workers-safe)
// ---------------------------------------------------------------------------

type HSL = { h: number; s: number; l: number };

function hexToHsl(hex: string): HSL {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l };
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return { h, s, l };
}

function hslToHex({ h, s, l }: HSL): string {
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  let r: number, g: number, b: number;

  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = (c: number) =>
    Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Darken and desaturate a hex color to produce a conservative "primary" variant.
 * Reduces saturation by 30% and lightness by 20%.
 */
function deriveConservativePrimary(hex: string): string {
  const hsl = hexToHsl(hex);
  return hslToHex({
    h: hsl.h,
    s: Math.max(0, hsl.s - 0.3),
    l: Math.max(0.1, hsl.l - 0.2),
  });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

function isValidHex(color: string): boolean {
  return HEX_COLOR_REGEX.test(color);
}

// ---------------------------------------------------------------------------
// Brand color extraction via Browser Rendering
// ---------------------------------------------------------------------------

type ExtractedColors = {
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  text_color?: string;
};

/**
 * Extracts brand colors from a company website using Browser Rendering's
 * AI-powered `/json` endpoint.
 *
 * The AI navigates the page, analyzes CSS, and returns dominant brand colors.
 * Results are validated, then the accent is used directly while the primary
 * is darkened/desaturated for a professional document appearance.
 *
 * @param env - Worker environment bindings
 * @param companyUrl - URL of the company website (e.g. "https://stripe.com")
 * @returns Brand color palette with primary + accent hex values
 */
export async function extractBrandColors(
  env: Env,
  companyUrl: string,
): Promise<BrandColorPalette> {
  try {
    // Normalize URL
    const url = companyUrl.startsWith("http") ? companyUrl : `https://${companyUrl}`;

    const colors = await extractJson<ExtractedColors>(env, url, {
      prompt: [
        "Extract the brand colors from this website.",
        "Look at the navigation bar, buttons, links, headers, and logo area.",
        "Return the primary brand color (the most dominant non-white/non-black color),",
        "the secondary color (if any), and the accent color (used for CTAs or highlights).",
        "Return all colors as 6-digit hex codes (e.g. #635BFF).",
      ].join(" "),
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "brand_colors",
          schema: {
            type: "object",
            properties: {
              primary_color: { type: "string", description: "Primary brand color as hex code" },
              secondary_color: { type: "string", description: "Secondary brand color as hex code" },
              accent_color: { type: "string", description: "Accent/CTA color as hex code" },
              text_color: { type: "string", description: "Main body text color as hex code" },
            },
            required: ["primary_color"],
          },
        },
      },
    });

    // Find the best brand color from the extracted result
    const brandColor = findBestBrandColor(colors);

    if (!brandColor) {
      console.warn(`Brand color extraction returned no valid colors for ${url}`);
      return { ...DEFAULT_BRAND_COLORS, source: url };
    }

    // Accent = direct brand color; Primary = darkened/desaturated variant
    return {
      accent: brandColor,
      primary: deriveConservativePrimary(brandColor),
      source: url,
    };
  } catch (error) {
    console.error("Brand color extraction failed:", error);
    return { ...DEFAULT_BRAND_COLORS, source: companyUrl };
  }
}

/**
 * Selects the most suitable brand color from extracted results.
 * Prefers primary_color > accent_color > secondary_color.
 * Filters out near-white, near-black, and invalid hex values.
 */
function findBestBrandColor(colors: ExtractedColors): string | null {
  const candidates = [
    colors.primary_color,
    colors.accent_color,
    colors.secondary_color,
  ];

  for (const hex of candidates) {
    if (!hex || !isValidHex(hex)) continue;

    // Skip near-white and near-black (too boring for branding)
    const hsl = hexToHsl(hex);
    if (hsl.l > 0.9 || hsl.l < 0.1) continue;
    if (hsl.s < 0.05) continue; // Skip grays

    return hex;
  }

  return null;
}
