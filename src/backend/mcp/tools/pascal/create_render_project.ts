import { z } from "zod";

import { createProject } from "../../../services/pascal/store";
import { defineTool, WRITE_IDEMPOTENT } from "../../types";
import { projectDto } from "./_shared";

export const createRenderProject = defineTool({
  name: "create_render_project",
  category: "render",
  title: "Create a Pascal render project",
  description:
    "Map a Core-Remodel scope (a floor, a room, or the whole home) to a Pascal layout project. Idempotent by `id`. Groups the studies + variants you'll explore in the 3D/2D editor. Returns the project + its editor URL.",
  inputShape: {
    name: z.string().min(1).describe("Human label, e.g. 'Upstairs layouts'."),
    coreRemodelProjectId: z
      .string()
      .min(1)
      .describe("Stable Core-Remodel identity every scene echoes back; e.g. '126-colby-upstairs'."),
    scopeType: z.enum(["floor", "room", "whole_home"]).default("whole_home"),
    floorId: z.number().int().positive().nullable().optional(),
    roomId: z.number().int().positive().nullable().optional(),
    id: z.string().min(1).max(64).optional().describe("Optional slug id; generated if omitted."),
  },
  annotations: WRITE_IDEMPOTENT,
  examples: [
    {
      title: "Project for the upstairs floor",
      args: { name: "Upstairs layouts", coreRemodelProjectId: "126-colby-upstairs", scopeType: "floor", floorId: 2 },
    },
  ],
  handler: async ({ env }, input) => {
    const row = await createProject(env, {
      id: input.id,
      name: input.name,
      coreRemodelProjectId: input.coreRemodelProjectId,
      scopeType: input.scopeType,
      floorId: input.floorId ?? null,
      roomId: input.roomId ?? null,
    });
    return projectDto(row, env);
  },
});
