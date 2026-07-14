/**
 * @fileoverview Artifact allow-listed scope — the single source of truth (0016).
 *
 * This catalog defines EXACTLY what a chat-built artifact may import. It is
 * consumed by two places that must never drift:
 *   1. the `list_allowed_components` MCP tool + `create_artifact` validator
 *      (backend), which reject any import outside this list, and
 *   2. the `/studio-runtime` island (frontend), whose scoped module loader maps
 *      each of these specifiers to the real bundled module.
 *
 * Hard rule (0016 §5): shadcn/ui components + the sanctioned libs below, on the
 * Monolith theme tokens — never a bespoke UI lib, never hardcoded colors.
 */

/** One entry in the allowed scope catalog. */
export interface AllowedEntry {
  /** Human-facing name (the export or lib). */
  name: string;
  /** The import specifier an artifact writes. */
  specifier: string;
  /** One-line usage hint shown to the agent. */
  hint: string;
}

/**
 * Allow-listed shadcn/ui components. Specifiers match the runtime scope map.
 * Curated to the stable primitives an artifact should compose — layout is done
 * with Tailwind utilities on plain `<div>`s, structural/interactive UI uses
 * these.
 */
export const ALLOWED_COMPONENTS: AllowedEntry[] = [
  { name: "Button", specifier: "@/components/ui/button", hint: "Buttons — variant/size props; never a raw <button>." },
  { name: "Card", specifier: "@/components/ui/card", hint: "Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter." },
  { name: "Badge", specifier: "@/components/ui/badge", hint: "Status pills — variant prop." },
  { name: "Input", specifier: "@/components/ui/input", hint: "Text input — never a raw <input>." },
  { name: "Textarea", specifier: "@/components/ui/textarea", hint: "Multiline input — never a raw <textarea>." },
  { name: "Label", specifier: "@/components/ui/label", hint: "Form labels tied to a control id." },
  { name: "Select", specifier: "@/components/ui/select", hint: "Select, SelectTrigger, SelectValue, SelectContent, SelectItem — never a raw <select>." },
  { name: "Checkbox", specifier: "@/components/ui/checkbox", hint: "Boolean toggle checkbox." },
  { name: "Switch", specifier: "@/components/ui/switch", hint: "On/off switch." },
  { name: "Slider", specifier: "@/components/ui/slider", hint: "Range slider." },
  { name: "Tabs", specifier: "@/components/ui/tabs", hint: "Tabs, TabsList, TabsTrigger, TabsContent." },
  { name: "Dialog", specifier: "@/components/ui/dialog", hint: "Modal dialog (Base UI under the hood — no Radix-only props)." },
  { name: "AlertDialog", specifier: "@/components/ui/alert-dialog", hint: "Confirm/destructive dialog — use instead of window.confirm." },
  { name: "Popover", specifier: "@/components/ui/popover", hint: "Popover, PopoverTrigger, PopoverContent." },
  { name: "Tooltip", specifier: "@/components/ui/tooltip", hint: "Tooltip, TooltipTrigger, TooltipContent, TooltipProvider." },
  { name: "Separator", specifier: "@/components/ui/separator", hint: "Divider (use instead of a 1px border)." },
  { name: "ScrollArea", specifier: "@/components/ui/scroll-area", hint: "Scrollable region." },
  { name: "Avatar", specifier: "@/components/ui/avatar", hint: "Avatar, AvatarImage, AvatarFallback." },
  { name: "Alert", specifier: "@/components/ui/alert", hint: "Alert, AlertTitle, AlertDescription — inline callouts." },
  { name: "AspectRatio", specifier: "@/components/ui/aspect-ratio", hint: "Constrain media to a ratio." },
  { name: "Chart", specifier: "@/components/ui/chart", hint: "ChartContainer, ChartTooltip, ChartTooltipContent — wrap recharts here for the Monolith palette." },
];

/** Allow-listed non-component libs + helpers. */
export const ALLOWED_LIBS: AllowedEntry[] = [
  { name: "React", specifier: "react", hint: "React + hooks (useState, useMemo, useEffect, …)." },
  { name: "recharts", specifier: "recharts", hint: "Charts — always wrap in <ChartContainer> for the Monolith palette." },
  { name: "lucide-react", specifier: "lucide-react", hint: "Icons." },
  { name: "cn", specifier: "@/lib/utils", hint: "The cn() className merge helper." },
  { name: "studioData", specifier: "@/studio/data", hint: "Read-only fetch helper for existing /api/* GETs (no writes in v1)." },
];

/** Every specifier an artifact may import (the mechanical allow-list). */
export const ALLOWED_SPECIFIERS: ReadonlySet<string> = new Set(
  [...ALLOWED_COMPONENTS, ...ALLOWED_LIBS].map((e) => e.specifier),
);
