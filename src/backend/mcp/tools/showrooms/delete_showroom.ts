import { showroomStores } from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { urlField } from "../../schemas";
import { showroomUrl } from "../../urls";
import { defineTool, DESTRUCTIVE } from "../../types";

export const deleteShowroom = defineTool({
  name: "delete_showroom",
  category: "showrooms",
  title: "Delete (soft) a showroom",
  description:
    "Remove a junk / bogus showroom from the directory. This is a SOFT delete: it flips the store's `is_active` to " +
    "0, so the row and all its history (links, hours, notes, ratings, mappings) are kept and it can be restored — " +
    "it just stops appearing in list_showrooms, the directory, the map, drives, and every other active-only " +
    "surface. Use this for genuine junk (not duplicates — for those use dedup_showroom_stores, which merges child " +
    "data onto the keeper first). Pass `restore: true` to undo (set it back to active). Idempotent. To see the " +
    "inactive rows afterward, call list_showrooms with `includeInactive: true`.",
  inputShape: {
    id: z.number().int().positive().describe("Showroom store id (from list_showrooms)"),
    restore: z
      .boolean()
      .optional()
      .describe("Set true to UN-delete (is_active back to 1). Default false = soft-delete."),
    reason: z
      .string()
      .optional()
      .describe("Optional short note on why it's junk — for the caller's own record; not persisted."),
  },
  annotations: DESTRUCTIVE,
  outputShape: {
    id: z.number().int(),
    name: z.string().nullable(),
    isActive: z.boolean(),
    changed: z.boolean().describe("True if this call flipped the flag (false if already in that state)."),
    url: urlField,
  },
  examples: [
    { title: "Delete a junk store", args: { id: 207 } },
    { title: "Restore one", args: { id: 207, restore: true } },
  ],
  handler: async ({ env, db }, input) => {
    const [store] = await db
      .select({ id: showroomStores.id, name: showroomStores.name, isActive: showroomStores.isActive })
      .from(showroomStores)
      .where(eq(showroomStores.id, input.id))
      .limit(1);
    if (!store) toolError(`No showroom found with id ${input.id}.`);

    const targetActive = input.restore === true;
    const changed = store.isActive !== targetActive;
    if (changed) {
      await db
        .update(showroomStores)
        .set({ isActive: targetActive, updatedAt: new Date() })
        .where(eq(showroomStores.id, input.id))
        .run();
    }

    return {
      id: store.id,
      name: store.name,
      isActive: targetActive,
      changed,
      url: showroomUrl(env, store.id),
    };
  },
});
