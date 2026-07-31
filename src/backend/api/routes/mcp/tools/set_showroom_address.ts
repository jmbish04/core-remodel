import { showroomStores } from "@backend/db/schema/showroom/index";
import { eq } from "drizzle-orm";

import type { ToolDef } from "../types";

export const setShowroomAddress: ToolDef = {
  name: "set_showroom_address",
  description:
    "Set / correct a showroom's address. For when Google Places got it wrong, the store moved, or intake missed it. Send any of the fields; only those are updated. The two zip fields are kept in sync.",
  inputSchema: {
    type: "object",
    properties: {
      storeId: { type: "number" },
      locationAddress: { type: "string", description: "Full formatted address." },
      locationStreetNumber: { type: "string" },
      locationStreetName: { type: "string" },
      locationCity: { type: "string" },
      locationState: { type: "string", description: "2-letter, e.g. CA." },
      locationZipCode: { type: "string" },
      googleMapsLink: { type: "string" },
    },
    required: ["storeId"],
  },
  handler: async ({ db, args }) => {
    const storeId = Number(args.storeId);
    const zip = (args.locationZipCode ?? args.zipCode) as string | undefined;
    const [row] = await db
      .update(showroomStores)
      .set({
        ...(args.locationAddress !== undefined ? { locationAddress: args.locationAddress } : {}),
        ...(args.locationStreetNumber !== undefined ? { locationStreetNumber: args.locationStreetNumber } : {}),
        ...(args.locationStreetName !== undefined ? { locationStreetName: args.locationStreetName } : {}),
        ...(args.locationCity !== undefined ? { locationCity: args.locationCity } : {}),
        ...(args.locationState !== undefined ? { locationState: args.locationState } : {}),
        ...(zip !== undefined ? { locationZipCode: zip, zipCode: zip } : {}),
        ...(args.googleMapsLink !== undefined ? { googleMapsLink: args.googleMapsLink } : {}),
        updatedAt: new Date(),
      })
      .where(eq(showroomStores.id, storeId))
      .returning({ id: showroomStores.id });
    return JSON.stringify({ ok: Boolean(row), storeId });
  },
};
