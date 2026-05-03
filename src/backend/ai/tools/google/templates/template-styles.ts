/**
 * @fileoverview Shared CSS styles for Google Docs–compatible HTML templates.
 *
 * Provides **builder functions** that accept optional brand colors.
 * When colors are provided, the template accent tones shift subtly to
 * match the target company's brand. When omitted, the defaults are used.
 *
 * Static exports (`BASE_STYLES`, `RESUME_STYLES`, `COVER_LETTER_STYLES`)
 * remain for backward compatibility — they call the builders with no args.
 *
 * ## Default Design Tokens
 *
 * | Token             | Value     | Usage                        |
 * |-------------------|-----------|------------------------------|
 * | Deep Navy         | `#1A365D` | Headings, borders, accents   |
 * | Premium Teal      | `#0D9488` | Target role, company name    |
 * | Dark Slate        | `#2D3748` | Body text, bullets           |
 * | Muted Gray        | `#4A5568` | Contact info, skill lists    |
 * | Light Gray        | `#718096` | Dates                        |
 * | Border Gray       | `#CBD5E0` | Section dividers             |
 * | Page Background   | `#f4f7f6` | Body background              |
 */

// ---------------------------------------------------------------------------
// Brand color type
// ---------------------------------------------------------------------------

export type BrandColors = {
  /** Replaces Deep Navy (#1A365D) — headings, borders, name. */
  primary?: string;
  /** Replaces Premium Teal (#0D9488) — target role, company name. */
  accent?: string;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_PRIMARY = "#1A365D";
const DEFAULT_ACCENT = "#0D9488";

function p(colors?: BrandColors): string {
  return colors?.primary ?? DEFAULT_PRIMARY;
}

function a(colors?: BrandColors): string {
  return colors?.accent ?? DEFAULT_ACCENT;
}

// ── Shared base styles (used by both resume and cover letter) ───────────

export function buildBaseStyles(colors?: BrandColors): string {
  return `
        body {
            font-family: 'Segoe UI', Arial, sans-serif;
            color: #2D3748;
            background-color: #f4f7f6;
            margin: 0;
            padding: 20px;
        }

        /* Header Section */
        .header {
            text-align: center;
            border-bottom: 3px solid ${p(colors)};
            padding-bottom: 15px;
        }
        .name {
            font-family: 'Georgia', serif;
            font-size: 38px;
            color: ${p(colors)};
            margin: 0 0 5px 0;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            font-weight: bold;
        }
        .target-role {
            font-family: 'Arial', sans-serif;
            font-size: 18px;
            color: ${a(colors)};
            margin: 0 0 10px 0;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .contact-info {
            font-size: 13px;
            color: #4A5568;
        }
        .contact-info a {
            color: ${p(colors)};
            text-decoration: none;
            font-weight: bold;
        }`;
}

// ── Resume-specific styles ──────────────────────────────────────────────

export function buildResumeStyles(colors?: BrandColors): string {
  return `
        body { line-height: 1.5; }
        .resume-container {
            max-width: 850px;
            margin: 0 auto;
            background-color: #ffffff;
            padding: 40px 50px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        .header { margin-bottom: 20px; }

        /* Section Headers */
        .section-title {
            font-family: 'Georgia', serif;
            font-size: 18px;
            color: ${p(colors)};
            border-bottom: 1px solid #CBD5E0;
            padding-bottom: 4px;
            margin-top: 25px;
            margin-bottom: 12px;
            text-transform: uppercase;
            font-weight: bold;
            letter-spacing: 0.5px;
        }

        /* Text & Paragraphs */
        p {
            margin: 0 0 10px 0;
            font-size: 14px;
            text-align: justify;
        }
        
        /* Experience Formatting */
        .job-header { margin-bottom: 5px; }
        .job-title-row {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 2px;
        }
        .job-title-row td {
            padding: 0;
            vertical-align: baseline;
        }
        .job-title {
            font-size: 16px;
            font-weight: bold;
            color: ${p(colors)};
        }
        .company {
            font-size: 15px;
            color: ${a(colors)};
            font-weight: bold;
        }
        .job-dates {
            font-size: 13px;
            color: #718096;
            text-align: right;
            font-weight: bold;
        }
        
        ul {
            margin: 0 0 15px 0;
            padding-left: 20px;
        }
        li {
            margin-bottom: 6px;
            font-size: 14px;
            color: #2D3748;
        }
        .metric {
            font-weight: bold;
            color: ${p(colors)};
        }

        /* Skills Table */
        .skills-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
            margin-bottom: 10px;
        }
        .skills-table td {
            padding: 4px 8px 4px 0;
            vertical-align: top;
        }
        .skill-category {
            font-weight: bold;
            color: ${p(colors)};
            white-space: nowrap;
            width: 20%;
        }
        .skill-list {
            color: #4A5568;
        }`;
}

// ── Cover letter–specific styles ────────────────────────────────────────

export function buildCoverLetterStyles(colors?: BrandColors): string {
  return `
        body { line-height: 1.6; }
        .cover-letter-container {
            max-width: 850px;
            margin: 0 auto;
            background-color: #ffffff;
            padding: 50px 60px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            min-height: 800px;
        }
        .header { margin-bottom: 40px; }

        /* Cover Letter Body */
        .date {
            margin-bottom: 25px;
            font-size: 15px;
            color: #2D3748;
        }
        .salutation {
            margin-bottom: 20px;
            font-size: 15px;
            font-weight: bold;
            color: ${p(colors)};
        }
        p {
            margin: 0 0 18px 0;
            font-size: 15px;
            text-align: justify;
        }
        .signature {
            margin-top: 40px;
            font-size: 15px;
        }
        .signature-name {
            font-family: 'Georgia', serif;
            font-size: 22px;
            color: ${p(colors)};
            font-weight: bold;
            margin-top: 10px;
        }`;
}

// ── Static backward-compat exports ──────────────────────────────────────

export const BASE_STYLES = buildBaseStyles();
export const RESUME_STYLES = buildResumeStyles();
export const COVER_LETTER_STYLES = buildCoverLetterStyles();
