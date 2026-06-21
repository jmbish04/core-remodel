import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";
import { projectSystemVariables } from "@backend/db";

export const adminConfigRouter = new Hono<{ Bindings: Env }>()
  .get("/", async (c) => {
    const db = drizzle(c.env.DB);
    const variables = await db.select().from(projectSystemVariables).all();
    return c.json({ variables });
  })
  .post(
    "/",
    zValidator(
      "json",
      z.object({
        variables: z.array(
          z.object({
            variableKey: z.string(),
            valueText: z.string(),
            unit: z.string().nullable().optional(),
            category: z.string().nullable().optional(),
            description: z.string().nullable().optional(),
            mappingRefKey: z.string().nullable().optional(),
          })
        ),
      })
    ),
    async (c) => {
      const db = drizzle(c.env.DB);
      const { variables } = c.req.valid("json");

      await db.transaction(async (tx) => {
        for (const variable of variables) {
          const mappingRefKey = variable.mappingRefKey || variable.variableKey;
          
          await tx
            .insert(projectSystemVariables)
            .values({
              variableKey: variable.variableKey,
              valueText: variable.valueText,
              unit: variable.unit || null,
              category: variable.category || null,
              description: variable.description || null,
              mappingRefKey,
            })
            .onConflictDoUpdate({
              target: projectSystemVariables.variableKey,
              set: {
                valueText: variable.valueText,
                unit: variable.unit || null,
                category: variable.category || null,
                description: variable.description || null,
                mappingRefKey,
              },
            })
            .run();
        }
      });

      const updated = await db.select().from(projectSystemVariables).all();
      return c.json({ success: true, variables: updated });
    }
  );
