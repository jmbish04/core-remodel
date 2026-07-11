/**
 * @fileoverview Shared Zod output-schema helpers for MCP tools.
 *
 * Every tool declares an `outputShape` (a Zod raw shape, like `inputShape`) so
 * the MCP server can register an `outputSchema`. That lets an AI client
 * anticipate the exact response shape BEFORE calling the tool, and lets the
 * transport return validated `structuredContent` alongside the human-readable
 * text (see `agent.ts`).
 *
 * VALIDATION CONTRACT — the MCP SDK validates the tool's returned
 * `structuredContent` against `z.object(outputShape)`, which STRIPS unknown
 * keys. Two rules keep that lossless and non-breaking:
 *   1. Enumerate every TOP-LEVEL key a handler returns (a missing key is
 *      dropped from structuredContent).
 *   2. For nested objects whose columns are many/variable, use `looseObject`
 *      (passthrough) so extra fields survive without listing each column.
 * Mark any conditionally-present key `.optional()` so validation can never fail.
 *
 * Money mirrors the handlers: `*Cents` integers plus a formatted `$` string.
 */
import { z } from "zod";

/**
 * A permissive object schema that PRESERVES unknown keys (Zod v4 "loose" mode).
 * Use for nested DTOs (a budget item, a showroom store, a material row) where
 * enumerating every column is noise — list the fields worth documenting and let
 * the rest pass through untouched.
 */
export function looseObject<S extends z.ZodRawShape>(shape: S) {
  return z.object(shape).loose();
}

/** A URL field: the absolute, clickable page to view the affected record. */
export const urlField = z
  .string()
  .describe("Absolute URL of the page where this record can be viewed");

/**
 * The standard pagination envelope returned by every list tool (mirrors
 * `paginate()` in `format.ts`). Pass the per-item schema; get back the raw
 * shape ready to spread into an `outputShape`.
 */
export function pageOutput(item: z.ZodTypeAny): z.ZodRawShape {
  return {
    items: z.array(item).describe("The page of results"),
    total: z.number().int().describe("Total matching rows across all pages"),
    count: z.number().int().describe("Rows in this page"),
    offset: z.number().int().describe("Offset this page started at"),
    has_more: z.boolean().describe("Whether more rows exist beyond this page"),
    next_offset: z.number().int().nullable().describe("Offset for the next page, or null"),
  };
}

/** Money pair as returned by DTOs: integer cents + a formatted `$` string. */
export const centsField = z.number().int().nullable();
export const dollarsField = z.string().describe("Formatted currency string, e.g. \"$1,234.56\"");
