/**
 * @fileoverview Cover letter HTML template for Justin Bishop.
 *
 * Exported as a string constant so it's bundled at build time by
 * esbuild/wrangler. No runtime file reads needed.
 *
 * ## Mustache Rendering
 *
 * Uses Mustache.js syntax. CSS is injected at render time via
 * `{{{STYLES}}}` (triple-stache for unescaped HTML). Contact info
 * is auto-merged from `CANDIDATE_INFO` constants.
 *
 * ## Placeholder Reference
 *
 * | Placeholder | Description | Injected By |
 * |-------------|-------------|-------------|
 * | `STYLES` | Combined CSS (base + cover letter) | `renderDocumentTemplate` |
 * | `full_name` | Candidate full name | `CANDIDATE_INFO` (auto-merged) |
 * | `email` | Candidate email | `CANDIDATE_INFO` (auto-merged) |
 * | `phone` | Candidate phone | `CANDIDATE_INFO` (auto-merged) |
 * | `linkedin` | Candidate LinkedIn | `CANDIDATE_INFO` (auto-merged) |
 * | `address` | Candidate city, state | `CANDIDATE_INFO` (auto-merged) |
 * | `TARGET_ROLE` | Job title being applied for | Agent per-application |
 * | `CURRENT_DATE` | Letter date | Agent per-application |
 * | `HIRING_MANAGER_NAME` | Recipient name or "Hiring Team" | Agent per-application |
 * | `COMPANY_NAME` | Target company name | Agent per-application |
 * | `COMPANY_ALIGNMENT_PARAGRAPH` | Custom paragraph connecting experience to company | Agent per-application |
 *
 * Static fields (signature) are hardcoded —
 * they don't change between applications.
 */

export const COVER_LETTER_HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<!--
  =======================================================================
  AI AGENT INSTRUCTIONS:
  This document is a Mustache-rendered cover letter template for Justin Bishop.
  The template engine handles all {{variable}} substitution at render time.
  
  EDITABLE FIELDS (provide in render context):
  - TARGET_ROLE: The specific job title being applied for.
  - COMPANY_NAME: The name of the target company.
  - HIRING_MANAGER_NAME: "Dear [Name]" or "Dear Hiring Team" if unknown.
  - COMPANY_ALIGNMENT_PARAGRAPH: Generate a custom 3-4 sentence paragraph 
    connecting Justin's 0-to-1 builder mentality and Google scale to the 
    specific pain points, mission, or JD of the target company.
  =======================================================================
-->
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{full_name}} - Cover Letter</title>
    <style>{{{STYLES}}}</style>
</head>
<body>

<div class="cover-letter-container">
    
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

    <!-- DATE -->
    <div class="date">{{CURRENT_DATE}}</div>

    <!-- SALUTATION -->
    <div class="salutation" data-ai-id="salutation">Dear {{HIRING_MANAGER_NAME}},</div>

    <!-- BODY PARAGRAPHS -->
    <div data-ai-id="cover-letter-body">
        
        <p>
            I am writing to express my enthusiastic interest in the <strong><span data-ai-id="inline-role">{{TARGET_ROLE}}</span></strong> position at <strong><span data-ai-id="inline-company">{{COMPANY_NAME}}</span></strong>. Over my 12+ year tenure at Google, I have built my career around a singular, non-negotiable truth: the highest-impact products and AI systems are only as effective as the data foundations they sit upon. I specialize in cutting through "rats nest" technical debt and ambiguity to architect scalable, user-driven solutions—a skill set I am eager to bring to your team.
        </p>

        <p>
            Throughout my four merit-based promotions (L2 to L5) within Google's Legal Operations, I have operated as an intrapreneur and a "Founding Builder." I am uniquely positioned at the intersection of complex legal requirements, data engineering, and product vision. When centralized enterprise systems failed to meet the nuanced needs of our global teams, I didn't wait for formal engineering resources. Instead, I architected and deployed lightweight, highly efficient data pipelines and internal applications. This hands-on approach allowed me to pioneer the technical overhaul of a legacy hardware preservation policy—delivering an automated solution that drastically reduced risk and generated an estimated <strong>$16 million in annual savings</strong>.
        </p>

        <p>
            Beyond immediate cost savings, I focus heavily on platform scalability and user adoption. By designing intake and workflow ecosystems that prioritize simplicity over academic over-engineering, I successfully reduced onboarding times by 70% and drove a <strong>300% increase in platform adoption</strong>. I am comfortable acting as the primary translator between highly specialized stakeholders (like attorneys or operations leads) and technical engineering teams, ensuring that we are building software that solves real pain points rather than hypothetical ones. 
        </p>

        <p data-ai-id="company-alignment-paragraph">
            {{{COMPANY_ALIGNMENT_PARAGRAPH}}}
        </p>

        <p>
            Thank you for considering my application. I would welcome the opportunity to discuss how my hybrid background in product strategy, data architecture, and operational leadership aligns with the future of <strong><span data-ai-id="inline-company-footer">{{COMPANY_NAME}}</span></strong>. 
        </p>

    </div>

    <!-- SIGNATURE -->
    <div class="signature">
        Sincerely,<br>
        <div class="signature-name">{{full_name}}</div>
    </div>

</div>

</body>
</html>`;
