/**
 * @fileoverview Tesla compositor vehicle image (0023 alerting).
 *
 * Builds the URL for Tesla's public vehicle "compositor" — the studio 3/4 render
 * of THIS car in its real paint + wheels — from the `vehicle_config` Tessie
 * reports. Rendered client-side in the global admin telemetry alert while a live
 * stream is active, so the operator sees their actual car.
 *
 * The car/paint/wheel → option-code maps are ported from the operator's iOS app.
 * Config is near-static, so the resolved URL is cached in KV for a day.
 *
 * NOTE: like the reference app, we only produce a background render for Model 3
 * and Model Y — S/X need a longer option-code string for a usable image. For
 * those, this returns null and the alert simply omits the picture.
 */
const TESSIE_BASE = "https://api.tessie.com";
const CACHE_KEY = "tesla:vehicle-image-url";
const CACHE_TTL_SECONDS = 24 * 60 * 60;
/** Sentinel cached when the car isn't a 3/Y (or config is unreadable), so we don't refetch each request. */
const NONE = "none";

import { getTessieConfig } from "@backend/services/tesla";

interface VehicleConfig {
  car_type?: string;
  exterior_color?: string;
  wheel_type?: string;
}

function carTypeToCode(carType: string | undefined): string {
  switch (carType) {
    case "model3":
      return "m3";
    case "modely":
      return "my";
    case "modelx":
      return "mx";
    case "models":
      return "ms";
    default:
      return "m3";
  }
}

function wheelTypeToCode(wheelType: string | undefined): string {
  switch (wheelType) {
    case "Pinwheel18":
      return "W38B";
    case "AeroTurbine20":
      return "WT20";
    case "Sportwheel19":
    case "Stiletto19":
      return "W39B";
    case "AeroTurbine19":
      return "WTAS";
    case "Turbine19":
      return "WTTB";
    case "Arachnid21Grey":
      return "WTAB";
    case "Performancewheel20":
    case "Stiletto20":
      return "W32P";
    case "AeroTurbine22":
      return "WT22";
    case "Super21Gray":
      return "WTSG";
    default:
      return "W38B";
  }
}

function colorNameToCode(colorName: string | undefined): string {
  switch (colorName) {
    case "ObsidianBlack":
    case "SolidBlack":
    case "MetallicBlack":
      return "PMBL";
    case "DeepBlueMetallic":
    case "DeepBlue":
      return "PPSB";
    case "RedMulticoat":
    case "Red":
      return "PPMR";
    case "MidnightSilverMetallic":
    case "MidnightSilver":
    case "SteelGrey":
    case "SilverMetallic":
      return "PMNG";
    case "MetallicBrown":
    case "Brown":
      return "PMAB";
    case "Silver":
      return "PMSS";
    case "TitaniumCopper":
      return "PPTI";
    case "DolphinGrey":
      return "PMTG";
    case "Green":
    case "MetallicGreen":
      return "PMSG";
    case "PearlWhiteMulticoat":
    case "PearlWhite":
    case "Pearl":
      return "PPSW";
    case "SolidWhite":
    case "White":
      return "PBCW";
    case "SignatureBlue":
    case "MetallicBlue":
      return "PMMB";
    case "SignatureRed":
      return "PPSR";
    default:
      return "PBSB";
  }
}

/** Build the compositor URL for a config, or null when it's not a 3/Y. */
export function buildCompositorUrl(config: VehicleConfig): string | null {
  const type = config.car_type;
  if (type !== "model3" && type !== "modely") return null;
  const model = carTypeToCode(type);
  const paint = colorNameToCode(config.exterior_color);
  const wheels = wheelTypeToCode(config.wheel_type);
  return (
    `https://static-assets.tesla.com/v1/compositor/` +
    `?model=${model}&view=STUD_3QTR&size=400&bkba_opt=1&options=${paint},${wheels}`
  );
}

/** Fetch the car's `vehicle_config` from Tessie's cached state (never wakes the car). */
async function fetchVehicleConfig(env: Env): Promise<VehicleConfig | null> {
  const cfg = await getTessieConfig(env);
  if (!cfg) return null;
  try {
    const res = await fetch(`${TESSIE_BASE}/${encodeURIComponent(cfg.vin)}/state?use_cache=true`, {
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { vehicle_config?: VehicleConfig };
    return data.vehicle_config ?? null;
  } catch {
    return null;
  }
}

/**
 * The compositor image URL for the configured car, or null (not 3/Y, unconfigured,
 * or unreadable). Cached in KV for a day since config is near-static.
 */
export async function getVehicleImageUrl(env: Env): Promise<string | null> {
  const cached = await env.CACHE.get(CACHE_KEY);
  if (cached != null) return cached === NONE ? null : cached;

  const config = await fetchVehicleConfig(env);
  const url = config ? buildCompositorUrl(config) : null;
  await env.CACHE.put(CACHE_KEY, url ?? NONE, { expirationTtl: CACHE_TTL_SECONDS });
  return url;
}
