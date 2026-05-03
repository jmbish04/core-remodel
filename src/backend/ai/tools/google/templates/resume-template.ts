/**
 * @fileoverview Resume HTML template for Justin Bishop.
 *
 * Exported as a string constant so it's bundled at build time by
 * esbuild/wrangler. No runtime file reads needed.
 *
 * ## Mustache Rendering
 *
 * This template uses **Mustache.js** syntax:
 * - `{{variable}}` — HTML-escaped variable substitution
 * - `{{{STYLES}}}` — unescaped CSS injection (triple-stache)
 * - `{{#array}}...{{/array}}` — array iteration
 * - `{{#condition}}...{{/condition}}` — conditional sections
 * - `{{^condition}}...{{/condition}}` — inverted (if-not) sections
 *
 * ## Placeholder Reference
 *
 * | Placeholder | Description | Injected By |
 * |-------------|-------------|-------------|
 * | `STYLES` | Combined CSS (base + resume) | `renderDocumentTemplate` |
 * | `full_name` | Candidate full name | `CANDIDATE_INFO` (auto-merged) |
 * | `email` | Candidate email | `CANDIDATE_INFO` (auto-merged) |
 * | `phone` | Candidate phone | `CANDIDATE_INFO` (auto-merged) |
 * | `linkedin` | Candidate LinkedIn | `CANDIDATE_INFO` (auto-merged) |
 * | `address` | Candidate city, state | `CANDIDATE_INFO` (auto-merged) |
 * | `TARGET_ROLE` | Job title being applied for | Agent per-application |
 * | `SUMMARY_STATEMENT` | Tailored professional summary | Agent per-application |
 * | `SKILLS_PRODUCT` | Product & Strategy skills list | Agent per-application |
 * | `SKILLS_DATA` | Data & Architecture skills list | Agent per-application |
 * | `SKILLS_TECH` | Technical stack skills list | Agent per-application |
 * | `SKILLS_AI` | AI & Advanced tools list | Agent per-application |
 * | `GOOGLE_BULLETS` | Google role bullet HTML | Agent per-application |
 * | `OSD_BULLETS` | OSD role bullet HTML | Agent per-application |
 *
 * Static fields (education, certifications) are hardcoded —
 * they don't change between applications.
 */

export const RESUME_HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<!--
  =======================================================================
  AI AGENT INSTRUCTIONS:
  This document is a Mustache-rendered resume template for Justin Bishop.
  The template engine handles all {{variable}} substitution at render time.
  
  EDITABLE FIELDS (provide in render context):
  - TARGET_ROLE: The specific job title being applied for.
  - SUMMARY_STATEMENT: Tailor the narrative to highlight Product, Data, or Legal Ops.
  - SKILLS_PRODUCT / SKILLS_DATA / SKILLS_TECH / SKILLS_AI: Reorder per JD.
  - GOOGLE_BULLETS: Tailored 4-5 bullet points (HTML <li> tags).
  - OSD_BULLETS: Tailored bullet points (HTML <li> tags).
  =======================================================================
-->
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{full_name}} - Professional Resume</title>
    <style>{{{STYLES}}}</style>
</head>
<body>

<div class="resume-container">
    
    <!-- HEADER -->
    <div class="header">
        <h1 class="name">{{full_name}}</h1>
        <div class="target-role" data-ai-id="target-role">{{TARGET_ROLE}}</div>
        <div class="contact-info">
            {{address}} &nbsp;|&nbsp; 
            {{phone}} &nbsp;|&nbsp; 
            <a href="mailto:{{email}}">{{email}}</a> &nbsp;|&nbsp; 
            <a href="https://{{linkedin}}">{{linkedin}}</a>
        </div>
    </div>

    <!-- PROFESSIONAL SUMMARY -->
    <div class="section-title">Professional Summary</div>
    <p data-ai-id="summary-statement">
        {{SUMMARY_STATEMENT}}
    </p>

    <!-- CORE COMPETENCIES & TECHNICAL SKILLS -->
    <div class="section-title">Core Competencies & Technical Skills</div>
    <table class="skills-table" data-ai-id="skills-grid">
        <tr>
            <td class="skill-category">Product & Strategy:</td>
            <td class="skill-list">{{SKILLS_PRODUCT}}</td>
        </tr>
        <tr>
            <td class="skill-category">Data & Architecture:</td>
            <td class="skill-list">{{SKILLS_DATA}}</td>
        </tr>
        <tr>
            <td class="skill-category">Technical Stack:</td>
            <td class="skill-list">{{SKILLS_TECH}}</td>
        </tr>
        <tr>
            <td class="skill-category">AI & Advanced Tools:</td>
            <td class="skill-list">{{SKILLS_AI}}</td>
        </tr>
    </table>

    <!-- PROFESSIONAL EXPERIENCE -->
    <div class="section-title">Professional Experience</div>
    
    <!-- GOOGLE EXPERIENCE -->
    <div class="job-header">
        <table class="job-title-row">
            <tr>
                <td><span class="job-title">Business Program Manager / Systems Architect (L5)</span> | <span class="company">Google</span></td>
                <td class="job-dates">Jan 2013 – Present</td>
            </tr>
        </table>
    </div>
    <ul data-ai-id="google-bullets">
        {{{GOOGLE_BULLETS}}}
    </ul>

    <!-- ONE SOURCE DISCOVERY EXPERIENCE -->
    <div class="job-header">
        <table class="job-title-row">
            <tr>
                <td><span class="job-title">Program Lead – Forensics Workflow & Reporting</span> | <span class="company">One Source Discovery</span></td>
                <td class="job-dates">Jan 2011 – Jan 2013</td>
            </tr>
        </table>
    </div>
    <ul data-ai-id="osd-bullets">
        {{{OSD_BULLETS}}}
    </ul>

    <!-- EDUCATION & CERTIFICATIONS -->
    <div class="section-title">Education & Certifications</div>
    <ul style="list-style-type: none; padding-left: 0; margin-bottom: 0;">
        <li style="margin-bottom: 8px;">
            <strong>University of Louisville</strong> — B.S. in Computer Information Systems & Entrepreneurship (<em>Cum Laude</em>)
        </li>
        <li style="margin-bottom: 8px;">
            <strong>UC Berkeley Executive Education</strong> — Certification in Product Management
        </li>
        <li>
            <strong>UC Berkeley Executive Education</strong> — Certification in Business Analysis
        </li>
    </ul>

</div>

</body>
</html>`;
