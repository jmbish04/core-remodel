/**
 * @fileoverview Mustache-based HTML template engine for Cloudflare Workers.
 *
 * Migrated from a custom regex `String.replace()` engine to Mustache.js
 * for native support of arrays (resume work history, skills, bullets)
 * and conditional sections (optional Projects, Certifications blocks).
 *
 * Mustache.js is CF Workers-safe — it uses pure string scanning and AST
 * walking, with no `eval()` or `new Function()`.
 *
 * Templates are loaded from co-located TypeScript string exports
 * (bundled at build time by esbuild/wrangler — no runtime file reads).
 *
 * ## Rendering Modes
 *
 * - `renderDocumentTemplate` — default colors, simple key-value + array rendering
 * - `renderBrandedDocumentTemplate` — company brand colors injected into CSS
 *
 * Both modes merge `CANDIDATE_INFO` into the render context automatically
 * so static fields (name, email, phone) are always available.
 */

import Mustache from "mustache";

import { RESUME_HTML_TEMPLATE } from "./resume-template";
import { COVER_LETTER_HTML_TEMPLATE } from "./cover-letter-template";
import { CANDIDATE_INFO } from "./constants";
import {
  buildBaseStyles,
  buildResumeStyles,
  buildCoverLetterStyles,
  BASE_STYLES,
  RESUME_STYLES,
  COVER_LETTER_STYLES,
  type BrandColors,
} from "./template-styles";

export type TemplateType = "resume" | "cover_letter";

/**
 * Load the raw resume HTML template string.
 */
export function loadResumeTemplate(): string {
  return RESUME_HTML_TEMPLATE;
}

/**
 * Load the raw cover letter HTML template string.
 */
export function loadCoverLetterTemplate(): string {
  return COVER_LETTER_HTML_TEMPLATE;
}

/**
 * Render an HTML template using Mustache.
 *
 * Supports:
 * - Simple variables: `{{TARGET_ROLE}}`
 * - Unescaped HTML: `{{{STYLES}}}` (for CSS injection)
 * - Arrays: `{{#jobs}}...{{/jobs}}`
 * - Conditionals: `{{#hasProjects}}...{{/hasProjects}}`
 * - Inverted: `{{^hasProjects}}...{{/hasProjects}}`
 *
 * The `CANDIDATE_INFO` constants are automatically merged into the view
 * so static personal fields are always available without explicit passing.
 */
export function renderTemplate(
  template: string,
  data: Record<string, unknown>,
): string {
  const view = { ...CANDIDATE_INFO, ...data };
  return Mustache.render(template, view);
}

/**
 * Convenience: load + render in one call with default styling.
 */
export function renderDocumentTemplate(
  type: TemplateType,
  data: Record<string, unknown>,
): string {
  const template = type === "resume" ? loadResumeTemplate() : loadCoverLetterTemplate();
  const styles =
    type === "resume"
      ? BASE_STYLES + RESUME_STYLES
      : BASE_STYLES + COVER_LETTER_STYLES;

  return renderTemplate(template, { ...data, STYLES: styles });
}

/**
 * Load + render with company brand colors injected into the CSS.
 *
 * Brand colors override the default Deep Navy (#1A365D) and Premium Teal
 * (#0D9488) tokens used for headings, borders, and accent elements.
 * Falls back to defaults for any missing color field.
 */
export function renderBrandedDocumentTemplate(
  type: TemplateType,
  data: Record<string, unknown>,
  brandColors: BrandColors,
): string {
  const template = type === "resume" ? loadResumeTemplate() : loadCoverLetterTemplate();
  const styles =
    type === "resume"
      ? buildBaseStyles(brandColors) + buildResumeStyles(brandColors)
      : buildBaseStyles(brandColors) + buildCoverLetterStyles(brandColors);

  return renderTemplate(template, { ...data, STYLES: styles });
}
