import { z } from "zod";

import { ALLOWED_COMPONENTS, ALLOWED_LIBS } from "../../artifacts/scope";
import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

export const listAllowedComponents = defineTool({
  name: "list_allowed_components",
  category: "artifacts",
  title: "List allowed artifact components",
  description:
    "The scope catalog for building artifacts: every shadcn/ui component (with its import specifier + a usage " +
    "hint) and the sanctioned libraries an artifact may use. CALL THIS BEFORE writing an artifact so your imports " +
    "and styling pass validation the first time. Artifacts must compose these components on Monolith theme tokens " +
    "— never a bespoke UI lib, never hardcoded colors, never inline styles, never raw <button>/<input>/<select>.",
  inputShape: {},
  annotations: READ_ONLY,
  outputShape: {
    components: z.array(
      looseObject({
        name: z.string(),
        specifier: z.string(),
        hint: z.string(),
      }),
    ),
    libs: z.array(
      looseObject({
        name: z.string(),
        specifier: z.string(),
        hint: z.string(),
      }),
    ),
    rules: z.array(z.string()),
  },
  examples: [{ title: "Get the catalog", args: {} }],
  handler: async () => ({
    components: ALLOWED_COMPONENTS,
    libs: ALLOWED_LIBS,
    rules: [
      "export default a single React component.",
      "Import ONLY from the specifiers listed here.",
      "Style with Tailwind LAYOUT utilities (grid/flex/gap/spacing) + Monolith theme tokens (bg-card, bg-primary, text-foreground, text-muted-foreground, border-border).",
      "No inline style={{…}}, no <style>, no hardcoded colors (text-red-500, bg-[#fff]).",
      "Interactive/structural UI uses shadcn components; plain <div>/<span> for layout only.",
      "Wrap recharts in <ChartContainer> for the Monolith chart palette.",
      "Read-only data access via @/studio/data (no writes in v1).",
    ],
  }),
});
