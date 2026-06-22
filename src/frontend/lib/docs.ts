export type DocsAudienceId = "homeowners" | "contractors" | "shared" | "platform";
export type DocsStatus = "live" | "planned";
export type DocsNoteTone = "info" | "planned";

export interface DocsActionLink {
  href: string;
  label: string;
  description: string;
}

export interface DocsSectionNote {
  title: string;
  body: string;
  tone?: DocsNoteTone;
}

/**
 * A Mermaid diagram embedded in a docs section. `code` is the raw Mermaid
 * source (flowchart, sequenceDiagram, erDiagram, stateDiagram-v2, …); it is
 * rendered client-side by the MermaidDiagram island. Source is authored in this
 * file only — never user-supplied.
 */
export interface DocsDiagram {
  code: string;
  caption?: string;
}

export interface DocsSectionDefinition {
  id: string;
  title: string;
  summary: string;
  paragraphs: string[];
  diagrams?: DocsDiagram[];
  bullets?: string[];
  actions?: DocsActionLink[];
  note?: DocsSectionNote;
}

export interface DocsPageDefinition {
  slug: string[];
  href: string;
  shortTitle: string;
  title: string;
  audience: DocsAudienceId;
  audienceLabel: string;
  status: DocsStatus;
  summary: string;
  overview: string;
  highlights: string[];
  actions: DocsActionLink[];
  sections: DocsSectionDefinition[];
}

export interface DocsAudienceGroup {
  id: DocsAudienceId;
  title: string;
  summary: string;
  pages: DocsPageDefinition[];
}

const homeownersPages: DocsPageDefinition[] = [
  {
    slug: ["homeowners", "getting-started"],
    href: "/docs/homeowners/getting-started",
    shortTitle: "Getting started",
    title: "Homeowner Getting Started",
    audience: "homeowners",
    audienceLabel: "For Homeowners",
    status: "live",
    summary: "Set up the project brief, define the first rooms, and give contractors a usable starting point.",
    overview:
      "Use Remodel Mission Control as the first shared brief for your project. The goal is not to finish every decision on day one. The goal is to give contractors enough context to understand the house, the rooms in scope, and the budget direction you want to protect.",
    highlights: [
      "Start with a single source of truth before sending links to contractors.",
      "Define scope room by room instead of trying to solve the whole house in one pass.",
      "Use homeowner messages to call out urgent changes, priorities, or unknowns.",
    ],
    actions: [
      {
        href: "/",
        label: "Open Mission Control",
        description: "Review the contractor-facing home page and homeowner message area.",
      },
      {
        href: "/access",
        label: "Review Access Flow",
        description: "Understand how protected contractor-only workspaces are gated.",
      },
    ],
    sections: [
      {
        id: "shared-brief",
        title: "Start with the shared brief",
        summary: "Mission Control is the project front door for both sides.",
        paragraphs: [
          "Use the home page to frame the remodel in plain language before you start sending contractors into individual tools. This is where you explain the intent of the project, the rooms in scope, and the current state of decision making.",
          "Post homeowner messages when something changed since the last review. Contractors should be able to open the app and immediately see whether the budget moved, a room was added, or a material choice is no longer current.",
        ],
        bullets: [
          "State the remodel goal in one paragraph.",
          "List the rooms or areas you want quoted first.",
          "Call out what is still unknown so contractors can price with that uncertainty in mind.",
        ],
      },
      {
        id: "room-scope",
        title: "Define renovation targets by room",
        summary: "Treat each room as its own decision container.",
        paragraphs: [
          "Most homeowners begin with a total budget and a loose set of goals. The app works better when that total is split into room-sized conversations. A bathroom, bedroom, or kitchen can each move at a different level of clarity.",
          "When you describe the scope room by room, contractors can understand what is essential, what is optional, and what needs a site visit or pricing conversation before it becomes real scope.",
        ],
        bullets: [
          "Start with the rooms that matter most to the first contractor conversation.",
          "Attach photos, inspiration, and notes to those rooms first.",
          "Expect the room brief to sharpen over time instead of being perfect up front.",
        ],
        actions: [
          {
            href: "/budget-tracker",
            label: "Open Budget Tracker",
            description: "Split the remodel budget into room and item-level targets.",
          },
          {
            href: "/floor-plan",
            label: "Open Floorplan Gallery",
            description: "Confirm which rooms are already mapped and visible from the plan.",
          },
        ],
      },
      {
        id: "contractor-hand-off",
        title: "Invite contractors into the same context",
        summary: "Share one workspace instead of sending scattered texts, PDFs, and screenshots.",
        paragraphs: [
          "Once the first room briefs, budget direction, and as-is photos are in place, the contractor can log into the same workspace and review the real context. That makes the estimate conversation faster and much less dependent on separate email threads.",
          "If you talk to multiple contractors, keep each one reviewing the same base information. That makes estimates easier to compare and reduces the chance that one bid reflects a different understanding of the project.",
        ],
        bullets: [
          "Do not restart the project brief for each contractor.",
          "Keep all revised notes in the app so every bidder sees the same latest direction.",
          "Use estimates and contracts later to separate pricing details from the core brief.",
        ],
      },
    ],
  },
  {
    slug: ["homeowners", "budget-and-scope"],
    href: "/docs/homeowners/budget-and-scope",
    shortTitle: "Budget and scope",
    title: "Homeowner Budget and Scope Planning",
    audience: "homeowners",
    audienceLabel: "For Homeowners",
    status: "live",
    summary: "Turn a whole-project number into room targets, decision gates, and revision-safe budget updates.",
    overview:
      "Budgeting is iterative in this product by design. Start with a room-level split, then refine it into clearer material, labor, and option decisions as contractors react to what is realistic and what is not.",
    highlights: [
      "Begin with rough allocations by room, not final line items.",
      "Use must-now versus later decisions to protect the total budget.",
      "Rebalance after estimate revisions instead of hiding changes in spreadsheets or text threads.",
    ],
    actions: [
      {
        href: "/budget-tracker",
        label: "Open Budget Tracker",
        description: "Work inside the mirrored D1 and Google Sheets budget workspace.",
      },
      {
        href: "/admin/estimates",
        label: "Open Estimates",
        description: "Compare current quote revisions against your room targets.",
      },
    ],
    sections: [
      {
        id: "first-pass",
        title: "Build the first budget pass",
        summary: "Start broad enough to move, but structured enough to compare later.",
        paragraphs: [
          "If the homeowner has fifty thousand dollars for a bathroom and bedroom renovation, the first job is not precision. The first job is allocating that money into rooms so the first contractor understands what the homeowner thinks each space needs to absorb.",
          "This first pass becomes the baseline for later estimate reviews. Even if the allocation is wrong, it gives both sides a place to discuss tradeoffs instead of arguing from memory.",
        ],
        bullets: [
          "Assign a working budget to each room or area.",
          "Capture whether an item is mandatory now or can happen later.",
          "Use notes to explain the intent behind a number when the amount is strategic rather than final.",
        ],
      },
      {
        id: "decision-gates",
        title: "Refine room targets into decision gates",
        summary: "Budget clarity improves when each room separates hard requirements from flexible options.",
        paragraphs: [
          "As the remodel brief matures, room budgets usually need a second layer: categories, options, and bottlenecks. That is where the homeowner starts distinguishing between structural work, finish materials, alternates, and future-phase ideas.",
          "This matters because contractors need to know which line items are price-sensitive and which ones can shift if labor, trade discounts, or product availability changes the best path.",
        ],
        bullets: [
          "Break rooms into smaller spend buckets when pricing starts to arrive.",
          "Track alternates when a similar look can save money.",
          "Use decision-gate notes to show what blocks progress on a room.",
        ],
      },
      {
        id: "rebalance",
        title: "Rebalance after estimates arrive",
        summary: "The budget should react to real bids instead of pretending the first guess was final.",
        paragraphs: [
          "Once estimates start showing up, the homeowner can compare the current budget direction to live pricing. Some rooms may need more budget, some may need scope reduction, and some material choices may need alternates.",
          "The important thing is to keep those changes revision-safe. Remodel Mission Control is designed so the budget conversation stays attached to the same project context the contractor is already reviewing.",
        ],
        bullets: [
          "Compare room targets against estimate totals and major line items.",
          "Capture why a number changed instead of only overwriting the value.",
          "Use contractor suggestions, including trade-discount alternates, to keep the budget grounded.",
        ],
      },
    ],
  },
  {
    slug: ["homeowners", "photos-and-materials"],
    href: "/docs/homeowners/photos-and-materials",
    shortTitle: "Photos and materials",
    title: "Homeowner Photos, Inspiration, and Materials",
    audience: "homeowners",
    audienceLabel: "For Homeowners",
    status: "live",
    summary: "Capture the existing house, add inspiration, and attach product evidence that contractors can react to.",
    overview:
      "Visual context is the fastest way to reduce bad assumptions in a remodel quote. Homeowners should use the upload, photo, review, mood board, and supporting document surfaces together so each room has clear as-is conditions and a believable target direction.",
    highlights: [
      "Document the house as it exists before focusing on dream-state inspiration.",
      "Keep inspiration photos tied to rooms and notes whenever possible.",
      "Attach product quotes, store links, screenshots, and PDFs so contractors can suggest practical alternates.",
    ],
    actions: [
      {
        href: "/uploads",
        label: "Open Uploads",
        description: "Add new listing or inspiration photos into the system.",
      },
      {
        href: "/listing-photos",
        label: "Open Listing Photos",
        description: "Review room metadata and existing-condition photography.",
      },
      {
        href: "/review",
        label: "Open Photo Reviews",
        description: "Sort, review, and tag inspirational images with AI support.",
      },
      {
        href: "/supporting-docs",
        label: "Open Supporting Documents",
        description: "Attach files, quotes, screenshots, and source references.",
      },
    ],
    sections: [
      {
        id: "existing-conditions",
        title: "Capture existing conditions first",
        summary: "Contractors price the house they see, not the house the homeowner imagines.",
        paragraphs: [
          "Listing photos and room-mapped images create the factual baseline for a remodel. Before the homeowner talks about tiles, vanities, or cabinetry, the contractor needs to understand the current condition, shape, and constraints of the space.",
          "The product already supports room metadata and floorplan-based review, which is why existing-condition photos should be uploaded and mapped early.",
        ],
        bullets: [
          "Photograph every room that may enter the scope.",
          "Map photos to rooms so the floorplan view stays useful.",
          "Include details that affect labor, such as awkward corners, windows, or visible damage.",
        ],
      },
      {
        id: "inspiration",
        title: "Save inspiration that explains intent",
        summary: "Inspiration is most useful when it says what the homeowner is trying to achieve, not just what they like.",
        paragraphs: [
          "Mood boards and photo reviews help homeowners collect target looks, layouts, and finish styles. The best inspiration sets explain why a reference matters: tile pattern, millwork profile, vanity size, lighting mood, or storage concept.",
          "That context lets the contractor suggest practical substitutions when a product is unavailable, overpriced, or not a good trade fit.",
        ],
        bullets: [
          "Use short notes to explain what is important in each reference.",
          "Favor room-specific inspiration over giant mixed boards when pricing is near.",
          "Keep target images attached to the room they are meant to influence.",
        ],
        actions: [
          {
            href: "/moodboards",
            label: "Open Mood Boards",
            description: "Organize inspiration into visual boards that are easier to review.",
          },
        ],
      },
      {
        id: "products-and-quotes",
        title: "Attach product links, quotes, and source evidence",
        summary: "Materials become decision-ready when the contractor can see the exact source and price context.",
        paragraphs: [
          "When the homeowner has a tile, fixture, or finish in mind, that choice should be documented with a link, quote, screenshot, PDF, or note in the supporting documents workspace. This is where the app becomes more than a picture gallery.",
          "A contractor can then respond with practical guidance. They may confirm the product works, note lead-time risk, or recommend a similar option that qualifies for a trade discount.",
        ],
        bullets: [
          "Attach the source store or vendor whenever possible.",
          "Save quotes even when the homeowner is still comparing options.",
          "Use notes to show whether a material is preferred, optional, or only visual inspiration.",
        ],
      },
    ],
  },
  {
    slug: ["homeowners", "questionnaire-and-ai-guidance"],
    href: "/docs/homeowners/questionnaire-and-ai-guidance",
    shortTitle: "Questionnaire and AI guidance",
    title: "Homeowner Questionnaire and AI Guidance",
    audience: "homeowners",
    audienceLabel: "For Homeowners",
    status: "live",
    summary: "Live room-aware questionnaire that surfaces build questions before they become costly misses, with AI-suggested room mappings the homeowner controls.",
    overview:
      "The standalone questionnaire is shipped at /questionnaire. Each section is parametric — adding new sections or questions in the database hydrates the UI automatically — and every committed answer can cascade into the budget tracker as a shadow item with cents-enforced estimates.",
    highlights: [
      "The questionnaire is room-aware, not a giant one-time form.",
      "Answers help contractors catch hidden scope, wiring, blocking, and finish implications.",
      "AI flags relevant question-to-room associations and the homeowner has final say via confirm or disassociate actions.",
    ],
    actions: [
      {
        href: "/questionnaire",
        label: "Open the questionnaire",
        description: "Pick a section and start capturing room-by-room build decisions.",
      },
      {
        href: "/docs/shared/collaboration-loop",
        label: "Read the Collaboration Loop",
        description: "See how questionnaire answers feed contractor review and pricing.",
      },
    ],
    sections: [
      {
        id: "why-questionnaire",
        title: "Why the questionnaire exists",
        summary: "The goal is to prevent expensive omissions before construction begins.",
        paragraphs: [
          "Many remodel decisions are not obvious from photos alone. A homeowner may want a television wall, under-cabinet lighting, extra blocking, future speakers, or a niche that affects framing and electrical work even if they do not know how to ask for it.",
          "The questionnaire brings those build-sensitive questions into the process early enough that contractors can account for them in scope and pricing.",
        ],
        bullets: [
          "Expect yes or no prompts that reveal hidden construction needs.",
          "Tie answers to rooms whenever possible.",
          "Use the answers to sharpen estimates, not to replace contractor judgment.",
        ],
      },
      {
        id: "room-context",
        title: "Answer questions in room context",
        summary: "Questions appear where the homeowner is already thinking about that room.",
        paragraphs: [
          "A bathroom, bedroom, kitchen, and media wall do not need the same prompts. The questionnaire feels lighter because answers can be provided while the homeowner is already reviewing photos, budget, and notes for a room.",
          "That makes the process less overwhelming than forcing the user through one giant intake checklist before the rest of the app becomes useful.",
        ],
        bullets: [
          "Associate each answer with one or more rooms.",
          "Answer incrementally as decisions become clearer.",
          "The contractor sees the resulting answers inside the room context they are pricing.",
        ],
      },
      {
        id: "ai-flagging",
        title: "AI surfaces the right prompts at the right time",
        summary: "Question relevance is derived from the room data the homeowner is already entering.",
        paragraphs: [
          "The rationale workflow watches the room brief, visual references, and uploaded materials, then proposes question-to-room mappings. A media-wall reference triggers blocking and power questions. A shower layout triggers waterproofing, niche, or fixture questions.",
          "Every AI suggestion is reviewable: confirming locks it as user_confirmed, dismissing it flips it to user_disassociated, and the workflow respects both states forever on subsequent runs.",
        ],
        bullets: [
          "AI proposes mappings; it never overrides homeowner decisions.",
          "Triggered questions remain reviewable and editable by the homeowner.",
          "Contractors see the resulting answers inside the room context they are pricing.",
        ],
      },
    ],
  },
  {
    slug: ["homeowners", "photo-edits"],
    href: "/docs/homeowners/photo-edits",
    shortTitle: "Photo edits",
    title: "Homeowner Guide: In-Photo Editing Pipeline",
    audience: "homeowners",
    audienceLabel: "For Homeowners",
    status: "live",
    summary: "Iteratively modify remodel photos, choose rendering strategy, and index revision embeddings.",
    overview:
      "The In-Photo Editing pipeline enables homeowners to run iterative AI-powered transformations on listing photos and inspiration images. It tracks full revision branches in D1, supports advanced cropping and visual compare tools, and generates multi-modal pooled vector embeddings stored in Vectorize for quick semantic search.",
    highlights: [
      "Launch edit sessions directly from listing views or manual image uploads.",
      "Support multiple edit strategies: layout rearrangement, paint swaps, furniture staging, and inspiration stitching.",
      "Automatically crop outputs and index concatenated 1536-dim embeddings for search matching.",
    ],
    actions: [
      {
        href: "/photo-edits",
        label: "Open Photo Editor",
        description: "Review current edit sessions or spin up a new visual transformation.",
      },
      {
        href: "/review",
        label: "Review Inspiration",
        description: "Audit inspirational images before stitching details into listing angles.",
      },
      {
        href: "/docs/homeowners/render-studio",
        label: "Read the Render Studio Guide",
        description: "Go deeper with the staged blank-canvas pipeline, multi-angle renders, and mood boards.",
      },
    ],
    sections: [
      {
        id: "visual-iteration",
        title: "Starting the visual iteration loop",
        summary: "Initialize tracked sessions that preserve version history.",
        paragraphs: [
          "To begin editing, homeowners create an 'Edit Session' centered around a specific room or angle. This is a persistent canvas that holds the sequence of visual revisions, ensuring you never lose the progression of your ideas.",
          "You can select one or more baseline listing photos from the mapped rooms catalog as the starting angle, select an edit category, and formulate prompt instructions that Workers AI stable-diffusion or uploaded custom renderings will fulfill.",
        ],
        bullets: [
          "Spin up new sessions from the Photo Edits sidebar card or from the listing detail page.",
          "Keep source images and target revisions grouped in a single container.",
          "Iteratively adjust prompts and compare versions side-by-side using the comparison slider.",
        ],
      },
      {
        id: "edit-strategies",
        title: "Selecting an edit strategy",
        summary: "Optimize results by classifying the nature of your design changes.",
        paragraphs: [
          "The system supports four distinct editing strategies that guide the visual pipeline:",
          "1. **Wall Layout Change:** Remove partitions, open spaces, adjust layouts, and establish a base architectural canvas.",
          "2. **Paint Color Visuals:** Test color palettes, finishes, accent walls, and texture treatments.",
          "3. **Staging / Furniture:** Populate structural shells with modern staging ideas, lighting fixtures, and decorative elements.",
          "4. **Inspirational Stitching:** Extract localized design details (like a custom cabinet profile) and merge them onto listing angles.",
        ],
        bullets: [
          "Set strategy mode inside the Create Session wizard.",
          "Add room-type overrides to direct the AI's understanding of space constraints.",
          "Provide baseline prompt templates that auto-fill into the interactive edit workspace.",
        ],
      },
      {
        id: "cropping-and-uploads",
        title: "Advanced cropping and manual uploads",
        summary: "Refine generated canvases and upload professional outputs.",
        paragraphs: [
          "For maximum control, the system does not limit you to fully automated AI generations. If you collaborate with a professional designer or render a separate layout, you can upload custom outputs directly into the session timeline.",
          "An integrated high-precision Cropper is available on all uploads. You can manipulate scale (zoom) and rotation dynamically to strip out browser UI, watermarks, or unwanted edges before final upload.",
        ],
        bullets: [
          "Upload manual rendered files directly in the revision card.",
          "Use the Cropper modal to adjust zoom levels from 1x to 4x and rotate up to 360 degrees.",
          "Confirm crops to create highly optimized, revision-ready JPEG/PNG deliverables.",
        ],
      },
      {
        id: "vectorize-indexing",
        title: "Vector indexing & multi-modal search",
        summary: "Embed visual and semantic metadata for instant project retrieval.",
        paragraphs: [
          "Every time a new revision is successfully created, the pipeline executes a multi-modal embedding generation pass.",
          "The system cross-pools two discrete 768-dimensional vector representations—BGE and Google Gemma—based on the prompt text and room metadata. It normalizes and concatenates them into a single 1536-dimensional coordinate array.",
          "This high-fidelity pooled embedding is indexed in the Cloudflare Vectorize `PHOTO_INDEX` database. This powers instant, semantic search queries across the entire photo gallery, making your iterative designs highly discoverable.",
        ],
        bullets: [
          "Pooling multiple model perspectives creates an optimized, stable search space.",
          "Embeddings are stored under the image ID inside the `core-remodel-photos` index.",
          "Search works natively across both text queries and visual semantic markers.",
        ],
        note: {
          title: "Looking for full-room renovation renders?",
          body: "This editor is best for freeform, localized edits to a single image. When you want a structure-faithful renovation rendered consistently across every camera angle in a room — with a staged base, rough-in, and photoreal finish, plus an auto-generated mood board — use the AI Render Studio instead. See the Render Studio guide for the full staged pipeline.",
          tone: "info",
        },
      },
    ],
  },
  {
    slug: ["homeowners", "render-studio"],
    href: "/docs/homeowners/render-studio",
    shortTitle: "Render Studio",
    title: "AI Render Studio & Mood Boards",
    audience: "homeowners",
    audienceLabel: "For Homeowners",
    status: "live",
    summary:
      "Turn a real listing photo into a structure-faithful renovation: strip the room to a blank canvas, render staged base, rough-in, and photoreal finish, keep every angle consistent, and auto-generate a mood board.",
    overview:
      "The AI Render Studio treats your room like a fashion fitting: the room is the model, the design is the outfit, and you can re-dress it with new floors, paint, cabinetry, fixtures, and lighting, then view the result from every angle. Instead of generating a brand-new room from a text prompt — which drifts, moves walls, and invents windows — the Studio always EDITS the real photo of your space. It runs a staged pipeline, saves every step as a node in a render state tree so edits branch and reuse cache, and renders each viewing angle so the room reads as the same kitchen throughout. When a finish render is complete, the system automatically composes a professional mood board from the design and links it back to the render.",
    highlights: [
      "Every render starts from the real blank canvas of your room, so walls, windows, openings, and proportions stay true.",
      "A staged pipeline (base, rough-in, finish) lets you change a single finish cheaply or move an element without losing the rest.",
      "One design renders consistently across all of a room's camera angles using a hero-and-reference technique.",
      "Finished renders auto-generate a linked, flatlay-style mood board summarized by AI into a title and description.",
    ],
    actions: [
      {
        href: "/builder",
        label: "Open Render Studio",
        description: "Configure a design and run the staged base, rough-in, and finish pipeline on a room.",
      },
      {
        href: "/gallery",
        label: "Open Render Gallery",
        description: "Browse finished renders with inspiration chips and per-angle results.",
      },
      {
        href: "/moodboards",
        label: "Open Mood Boards",
        description: "Review auto-generated and hand-built mood boards linked to your renders.",
      },
      {
        href: "/docs/homeowners/photo-edits",
        label: "Compare with the Photo Editor",
        description: "Use the freeform In-Photo editor for localized single-image edits.",
      },
    ],
    sections: [
      {
        id: "fidelity-first",
        title: "Fidelity first: edit the real room, never invent one",
        summary: "The single most important design principle is that renders stay architecturally faithful to your actual space.",
        paragraphs: [
          "The number one rule of the Render Studio is fidelity. A homeowner and contractor can only make decisions from a render if the rendered room is genuinely their room. Text-to-image generation is unreliable for this: ask a model for 'a renovated kitchen' and it will happily relocate the sink wall, widen the window, raise the ceiling, and re-crop the framing. None of those choices are real, and pricing a fantasy room wastes everyone's time.",
          "To prevent that drift, the Studio always performs an EDIT on the real, existing photo of your room rather than generating from scratch. The starting image is a 'blank canvas' — your listing photo with the existing furniture and clutter stripped out — so the model only ever has to add what you asked for on top of true architecture, never reconstruct the space.",
          "Three guardrails enforce fidelity on every single stage. First, output framing and resolution are pinned: the render is locked to the source photo's aspect ratio and a high-resolution target, so the model cannot silently re-crop to portrait or downscale. Second, a strict structure-preservation instruction block is attached to every prompt, telling the model exactly what it must not touch. Third, any reference image you attach is scoped to material and form only, so the model borrows a finish's color and texture without importing that reference photo's camera angle, floor, props, or scene.",
        ],
        bullets: [
          "Renders are edits of your real photo, so they cannot invent a different room.",
          "Output aspect ratio and resolution are pinned to the source, preventing re-cropping and downscaling.",
          "A preservation prompt protects walls, windows, openings, floor, ceiling, framing, and camera angle.",
          "Reference images contribute material and form only — never their angle or background.",
        ],
        note: {
          title: "Why this matters for your budget",
          body: "Because the geometry is preserved, a contractor can price what they see. A render that quietly moved a wall or enlarged a window would invite estimates for work that does not exist — fidelity keeps the visual brief honest.",
          tone: "info",
        },
      },
      {
        id: "staged-pipeline",
        title: "The staged pipeline: blank canvas to photoreal finish",
        summary: "Renovations are built in deliberate stages so each layer can be reviewed, reused, and re-edited.",
        paragraphs: [
          "Rather than asking for a finished kitchen in one shot, the Studio composes the renovation in stages, and every stage output is saved so you can build on it later. Thinking of the room as a model being dressed, each stage adds another layer of the outfit.",
          "It begins with the blank canvas: your real listing photo with existing furniture and fixtures removed, leaving true walls, floor, windows, and openings. From there the pipeline runs three main stages.",
          "1. **Stage 1 — Base.** Establishes the room's foundational surfaces: the floor material and the wall paint. This sets the palette and mood while leaving structure untouched.",
          "2. **Stage 2 — Rough-in.** Places the major elements — cabinetry, an island, large fixtures — into the space. This is a structure-preserving placement pass: it positions volumes correctly against the real room without yet resolving every photoreal material detail.",
          "3. **Stage 3 — Finish.** Resolves photorealistic materials, reflections, and lighting so the render reads like a real photograph of the finished room.",
          "Staging the work this way is not just tidy; it is what makes editing cheap and reliable. Because the base and rough-in already exist as saved layers, the finish stage can focus only on the surface realism, and later changes can rewind to exactly the right layer instead of regenerating the entire room.",
        ],
        bullets: [
          "Stage 0 (blank canvas): the real room with furniture stripped, structure intact.",
          "Stage 1 (base): floor material plus wall paint.",
          "Stage 2 (rough-in): cabinetry, island, and fixture placement, preserving structure.",
          "Stage 3 (finish): photoreal materials, reflections, and lighting.",
        ],
      },
      {
        id: "state-tree",
        title: "The render state tree: branch, reuse, and rewind",
        summary: "Every stage output is a saved node, so edits reuse cached work and branch cleanly instead of starting over.",
        paragraphs: [
          "Each stage output is persisted as a node in a render state tree. Nodes record their stage, their parent, the prompt and model used, the lighting profile, and the resulting image. Because the lineage is preserved, the Studio can be smart about where an edit should attach — and that distinction is what keeps iteration fast and consistent.",
          "Edits fall into two kinds. A micro-edit changes a surface detail — swapping a countertop material, trying a different cabinet color — and it reuses the latest finish node as its starting point, so only the requested finish is re-rendered while everything else stays identical. A macro-edit changes the room's composition — moving the island, relocating a fixture — and it rewinds to the base node and creates a new branch, because a structural change cannot safely be patched on top of a finish that assumed the old layout.",
          "The practical payoff is that you can explore freely without losing work. Two countertop options become two branches off the same finish; a different island layout becomes a branch off the base. Every option remains visible in the tree, and shared upstream stages are reused from cache instead of being regenerated, which keeps both cost and render time down.",
        ],
        bullets: [
          "Each stage output is a node with parent lineage, prompt, model, and lighting recorded.",
          "Micro-edit (swap a finish): reuses the latest finish node, re-rendering only the requested change.",
          "Macro-edit (move an element): rewinds to the base node and branches a new line of work.",
          "Branches keep every option inspectable while reusing cached upstream stages.",
        ],
      },
      {
        id: "multi-angle",
        title: "Multi-angle consistency with hero and reference",
        summary: "One design renders across every camera angle of a room so it reads as the same space throughout.",
        paragraphs: [
          "A room is usually photographed from several angles, and a design is only believable if it looks like the same room from each one. The Studio achieves this with a hero-and-reference technique rather than rendering each angle independently and hoping they match.",
          "First, one angle is chosen as the hero and rendered through the full staged pipeline to a finished result. Then every other angle is rendered with the hero's finished image attached as a consistency reference, with an instruction that amounts to: 'this is the same kitchen — render it from this viewpoint and match its materials, layout, cabinetry, and fixtures exactly, while keeping this angle's real walls, windows, and openings unchanged.'",
          "Because each non-hero render still edits that angle's own real blank canvas, the true geometry of each viewpoint is preserved while the design carries over faithfully from the hero. The result is a set of renders that a homeowner and contractor can review together as one coherent room, not a collection of loosely related images. The hero render is remembered on the session so the whole set stays anchored to a single source of truth.",
        ],
        bullets: [
          "Pick a hero angle and render it fully first.",
          "Render every other angle with the hero attached as a 'same kitchen, this viewpoint' reference.",
          "Each angle still edits its own real canvas, so per-angle geometry stays true.",
          "The hero is recorded on the session to keep the whole room consistent.",
        ],
      },
      {
        id: "lighting-inspiration-synthesis",
        title: "Lighting, inspiration extraction, and multi-image synthesis",
        summary: "Tune the mood with day or night lighting and pull precise details from inspiration photos.",
        paragraphs: [
          "Renders carry a lighting profile so you can see a room in different conditions. Beyond the default, day and night profiles let you preview how the same finish reads in bright daylight versus warm evening light — useful for judging paint colors, cabinet tones, and how fixtures glow after dark.",
          "Inspiration extraction lets you borrow a specific detail instead of a whole photo. On an inspiration image, you draw a bounding box around the exact region you care about — a tile pattern, a faucet form, a cabinet profile — and that selection is recorded as a reference tied to the render. In the gallery, inspiration chips can highlight the selected region back on the original inspiration image so it is clear what was borrowed and from where.",
          "Multi-image synthesis combines several sources into one render. Your working canvas plus one or more inspiration references are sent to the model in an explicit, user-orderable sequence, where the base canvas is the first image and each inspiration reference follows. The ordering is meaningful: it controls how the model prioritizes and blends the references, and you can rearrange the chips to change the emphasis before rendering.",
        ],
        bullets: [
          "Day and night lighting profiles preview the same design in different conditions.",
          "Bounding-box selection extracts a precise region from an inspiration photo as a scoped reference.",
          "Gallery chips highlight the borrowed region on the source inspiration image.",
          "Multi-image synthesis blends the base canvas with ordered inspiration references; the order sets the emphasis.",
        ],
      },
      {
        id: "models-and-resilience",
        title: "Models, the AI gateway, and graceful failover",
        summary: "A proven default engine with a swappable, observable model registry behind every stage.",
        paragraphs: [
          "The default engine for every stage is Gemini 3 Pro Image (also known as Nano Banana Pro). It was chosen because, with the output configuration pinned to a fixed aspect ratio and a high-resolution target, it produces controlled, architecturally faithful, multi-reference edits — exactly the behavior fidelity demands. Every model call, regardless of provider, is routed through the Cloudflare AI Gateway so the team gets unified observability, caching, and key management.",
          "The engine is not hard-wired. A per-stage model registry makes each stage's model swappable, which supports A/B comparison and provider flexibility. Through the gateway's Fal path the Studio can reach a base editor, a conversational interaction model, a finish model, a multi-image synthesis model, and a faster rough-in alternate, with an additional edit model available for try-on. Through the gateway's Replicate path it can reach a depth-locked rough-in model and a premium finish model; Replicate runs asynchronously, so those calls create a job and then wait for or poll the result.",
          "Reliability is handled by a failover layer. If the primary model for a stage hits a transient fault — a rate limit or a server error — the system automatically steps down to the next compatible model, which may be on a different provider, and records that a fallback occurred. Genuine input errors are never masked behind a fallback; they surface so the real problem can be fixed.",
        ],
        bullets: [
          "Default engine: Gemini 3 Pro Image (Nano Banana Pro) for all stages, with pinned aspect ratio and 2K resolution.",
          "All providers (Gemini, Fal, Replicate) are routed through the Cloudflare AI Gateway for observability and caching.",
          "Fal options cover base, conversational interaction, finish, multi-image synthesis, a rough-in alternate, and try-on.",
          "Replicate options cover depth-locked rough-in and premium finish, and run asynchronously (create then poll or wait).",
          "A per-stage registry makes engines swappable; a failover layer steps down on transient faults and never hides fatal errors.",
        ],
        note: {
          title: "Model slugs",
          body: "The default and alternate models are kept in one configuration module so engines can be retuned per stage without touching the pipeline. Fal and Replicate slugs are verified against the live catalogs before they are enabled.",
          tone: "info",
        },
      },
      {
        id: "structure-preservation-prompt",
        title: "The structure-preservation prompt block",
        summary: "The exact guardrails attached to every stage prompt to stop architectural drift.",
        paragraphs: [
          "Fidelity is enforced in language as well as in configuration. Every stage prompt opens by framing the model as an expert architectural photo editor performing a natural, localized, photorealistic edit, and then attaches a strict preservation block that spells out what must remain untouched.",
          "That block instructs the model to preserve exactly — changing in no way — the flooring and its material, color, finish, and plank direction; every wall and wall color; all windows and their grids; all openings; the ceiling; and the room's dimensions, proportions, and camera angle. It forbids inventing, moving, widening, or closing any wall, window, or opening. It forbids cropping, zooming, panning, rotating, re-framing, or changing the aspect ratio, requiring the output framing to match the input one-to-one. And it forbids adding any furniture, rugs, decor, plants, or props that were not explicitly requested.",
          "When a reference image is attached, an additional scoping line tells the model to use that reference only for its material, color, veining, and form, and to ignore its camera angle, orientation, floor, props, lighting, and background. The prompt closes by requiring the model to return only the final edited image and no text. An optional structural QA gate can compare the render against the blank canvas afterward to confirm no wall, window, or opening was added, moved, or closed, and to retry with a strengthened prompt if drift is detected.",
        ],
        bullets: [
          "Preserve exactly: floor (material/color/finish/plank direction), walls and colors, windows and grids, openings, ceiling, dimensions, proportions, and camera angle.",
          "Never invent, move, widen, or close a wall, window, or opening.",
          "Never crop, zoom, pan, rotate, re-frame, or change the aspect ratio; match input framing one-to-one.",
          "Never add unrequested furniture, rugs, decor, plants, or props.",
          "Scope references to material and form only; return only the final image.",
        ],
      },
      {
        id: "mood-boards",
        title: "Mood boards: auto-generated and on demand",
        summary: "Professional flatlay mood boards generated from prompts, images, or both — and linked to finished renders.",
        paragraphs: [
          "A mood board captures the feel of a design as a single, organized flatlay image. The Studio can create one in three ways: from a prompt only, from one or more images only, or from a prompt combined with images, in which case the prompt acts as context that guides how the supplied images are arranged and interpreted. Each mood board is stored together with the request that produced it, so the inputs behind a board are never lost.",
          "Most importantly, mood boards are generated automatically. When a finish render completes, the system composes a mood board from that design and links it back to the render, giving every finished room a ready-made companion board with no extra effort. Boards are servable by room, by floor, and by keywords, so the right inspiration surfaces in the right context across the app.",
          "To make boards easy to skim and search, Workers AI's llama-3.2-11b-vision model reads the generated board and summarizes it into a concise title and description. That turns a wall of imagery into something a homeowner or contractor can scan, reference in conversation, and find again later.",
        ],
        bullets: [
          "Generate from a prompt only, image(s) only, or prompt plus images (the prompt contextualizes the images).",
          "Every mood board is stored with the request that created it.",
          "Finished renders auto-generate a linked mood board.",
          "Boards are servable by room, floor, and keywords.",
          "llama-3.2-11b-vision summarizes each board into a title and description.",
        ],
      },
      {
        id: "mood-board-prompt",
        title: "The mood board generation prompt",
        summary: "The exact prompt used to compose a professional, flatlay-style mood board image.",
        paragraphs: [
          "Mood board images are composed with a single, deliberate prompt designed to produce a clean, professional flatlay rather than a cluttered collage. It is reproduced verbatim below so the output style is explicit and stable.",
          "CREATE A PHOTOGRAPH OF AN INTERIOR DESIGN MOOD BOARD THAT INCORPORATES ELEMENTS FROM ALL THE UPLOADED IMAGES. THE MOOD BOARD SHOULD BE ORGANIZED, THOUGHT OUT, AND CRAFTED LIKE A PROFESSIONAL INTERIOR DESIGN MOOD BOARD FLATLAY FOR DESIGN PURPOSES. MINIMALLY OVERLAP ELEMENTS WHEN APPLICABLE AND USE DESIGN TECHNIQUES LIKE COLLAGING AND TRANSPARENCY. WHITE BACKGROUND. DO NOT INCLUDE ANY TEXT.",
          "The instructions to keep the layout organized, to minimally overlap elements, to use collaging and transparency, to keep a white background, and to include no text are what give every board a consistent, presentation-ready look that reads clearly whether it was built from a prompt, from images, or auto-generated from a finished render.",
        ],
        bullets: [
          "Incorporates elements from all the supplied images.",
          "Crafted like a professional interior-design flatlay for design purposes.",
          "Minimal element overlap; uses collaging and transparency.",
          "White background and no text, for a clean, consistent result.",
        ],
      },
      {
        id: "mcp-automation",
        title: "Drive the renderer from Claude with the MCP tool",
        summary: "An OAuth-secured MCP tool lets Claude operate the Render Studio on your behalf.",
        paragraphs: [
          "The Render Studio is also exposed through an OAuth-authenticated MCP (Model Context Protocol) tool, which lets Claude drive the renderer directly. With the tool connected, you can describe a renovation in conversation and have the staged pipeline, multi-angle fan-out, and mood board generation carried out for you, rather than clicking through each step in the builder.",
          "Because the tool is OAuth-secured, access is gated to authorized users and runs against the same pipeline, models, and state tree as the in-app Studio. That means an assistant-driven render is just as faithful and just as inspectable as one you build by hand — the results land as nodes in the same render tree, with the same linked mood boards.",
        ],
        bullets: [
          "An OAuth-secured MCP tool exposes the renderer to Claude.",
          "Claude can run the staged pipeline, multi-angle renders, and mood boards conversationally.",
          "Assistant-driven renders use the same pipeline, models, and state tree as the in-app Studio.",
        ],
      },
    ],
  },
  {
    slug: ["homeowners", "permits"],
    href: "/docs/homeowners/permits",
    shortTitle: "Permit Pipeline",
    title: "Homeowner Guide: Permits Intelligence Pipeline",
    audience: "homeowners",
    audienceLabel: "For Homeowners",
    status: "live",
    summary: "Understand how the permits pipeline tracks DBI records and extracts contractor workloads.",
    overview:
      "The Permits Intelligence Pipeline autonomously monitors the San Francisco Department of Building Inspection (SF DBI) databases to track the status of your remodeling permits and evaluate contractor workloads in real-time.",
    highlights: [
      "Track active building, planning, electrical, and plumbing permits on your property.",
      "Automatically extract and cross-reference contractors associated with your project.",
      "Monitor contractor permit portfolios across the entire city to identify project spikes or delay risks.",
    ],
    actions: [
      {
        href: "/admin/permits",
        label: "Open Permits Dashboard",
        description: "View active building permits, block/lot configurations, and contractor details.",
      },
    ],
    sections: [
      {
        id: "pipeline-operations",
        title: "How the pipeline operates",
        summary: "Hourly synchronization with the SF DBI databases.",
        paragraphs: [
          "The core pipeline is built on top of Cloudflare Workers and syncs directly with the SF DBI SODA API datasets. It performs background synchronization tasks to pull the latest permit data.",
          "The synchronization runs hourly. It queries active records from Building Permits, Planning Department records, and Electrical/Plumbing Permits datasets, compares them against known local states, and computes differences to detect status changes.",
        ],
        bullets: [
          "Synchronizes hourly via background cron jobs.",
          "Monitors SF DBI Building, Planning, Electrical, and Plumbing datasets.",
          "Computes local differences to alert on permit status updates.",
        ],
      },
    ],
  },
];

const contractorsPages: DocsPageDefinition[] = [
  {
    slug: ["contractors", "mission-control"],
    href: "/docs/contractors/mission-control",
    shortTitle: "Mission control",
    title: "Contractor Mission Control",
    audience: "contractors",
    audienceLabel: "For Contractors",
    status: "live",
    summary: "Use the home workspace as the current project brief before opening any individual room or estimate tool.",
    overview:
      "The contractor-facing home page is supposed to orient the job quickly. It highlights the latest project updates, homeowner messages, and the recommended route through the rest of the workspace so the contractor can understand the brief before reacting with pricing or scope feedback.",
    highlights: [
      "Start with the home briefing hub instead of jumping straight into random assets.",
      "Use homeowner messages as the current change log for the project.",
      "Treat the app as the current record, not just a file drop.",
    ],
    actions: [
      {
        href: "/",
        label: "Open Mission Control",
        description: "Review navigation guidance, recent updates, and homeowner messages.",
      },
      {
        href: "/access",
        label: "Open Access Gate",
        description: "Authenticate into protected contractor workspaces when required.",
      },
    ],
    sections: [
      {
        id: "briefing-hub",
        title: "Open the briefing hub first",
        summary: "The app home page tells you where to review the project in the right order.",
        paragraphs: [
          "Mission Control is meant to act like a contractor briefing sheet, not just a landing page. It tells you which features to open next, shows recent movement in the project, and surfaces the homeowner notes that matter before you price or suggest changes.",
          "That shortens the time between first access and useful feedback because you are not hunting through every screen to understand what changed.",
        ],
        bullets: [
          "Check the guided navigation cards first.",
          "Scan recent updates to see what images or assets were added.",
          "Read homeowner messages before assuming the budget or priorities are unchanged.",
        ],
      },
      {
        id: "messages",
        title: "Read homeowner messages before pricing",
        summary: "Messages provide the context that often explains why a room changed direction.",
        paragraphs: [
          "Homeowner messages should call out changes in scope, budget, urgency, or open questions. Reviewing them first prevents estimates from being anchored to stale assumptions.",
          "If multiple contractors are involved, this message layer also helps keep bidders aligned on the same latest brief.",
        ],
        bullets: [
          "Look for scope changes, new priorities, or unresolved questions.",
          "Use the rest of the workspace to validate the message against the current visual and document evidence.",
          "Expect the message layer to change between estimate revisions.",
        ],
      },
      {
        id: "current-record",
        title: "Use the workspace as the current record",
        summary: "The app should reduce private side threads and missing context.",
        paragraphs: [
          "This product is intended to become the running project context from early pricing through later contract and construction communication. A contractor should be able to review rooms, supporting documents, budgets, and estimate revisions in one place.",
          "That does not replace site visits or trade expertise. It does make the homeowner's design intent, room priorities, and evidence easier to read without reconstructing the project from email attachments.",
        ],
        bullets: [
          "Move from the home page into room review, not directly into contract paperwork.",
          "Keep price-sensitive recommendations tied to the relevant room or document context.",
          "Use the estimate and contract workspaces for formal revisions after the brief is understood.",
        ],
      },
    ],
  },
  {
    slug: ["contractors", "room-review"],
    href: "/docs/contractors/room-review",
    shortTitle: "Room review",
    title: "Contractor Floorplan and Room Review",
    audience: "contractors",
    audienceLabel: "For Contractors",
    status: "live",
    summary: "Start from the floorplan, drill into room visuals, and compare the current house to the target direction.",
    overview:
      "The room review workflow is where contractors should understand what exists, what the homeowner wants, and what evidence supports that decision. It uses the floorplan gallery, listing photos, supporting documents, and decision room together.",
    highlights: [
      "The floorplan view is the fastest way to understand targeted rooms.",
      "Room-level photos establish existing conditions before design comparisons happen.",
      "Decision Room helps you compare as-is, inspiration, and AI render candidates side by side.",
    ],
    actions: [
      {
        href: "/floor-plan",
        label: "Open Floorplan Gallery",
        description: "Start from the plan and jump into room-specific context.",
      },
      {
        href: "/listing-photos",
        label: "Open Listing Photos",
        description: "Review the underlying room-mapped image library.",
      },
      {
        href: "/decision-room",
        label: "Open Decision Room",
        description: "Compare listing photos, inspiration, and promoted render candidates.",
      },
      {
        href: "/supporting-docs",
        label: "Open Supporting Documents",
        description: "Review room-linked files, quotes, and planning artifacts.",
      },
    ],
    sections: [
      {
        id: "start-from-floorplan",
        title: "Start from the floorplan",
        summary: "Room dots on the plan help a contractor understand scope without guessing which photos belong where.",
        paragraphs: [
          "The gallery page is designed to make the floorplan the first navigation layer. It lets the contractor see which rooms are in play and jump directly into room-specific visuals instead of browsing an undifferentiated image list.",
          "This is especially useful when the project spans multiple floors or when similar rooms need to be distinguished before pricing begins.",
        ],
        bullets: [
          "Use the floor selector first.",
          "Click the room marker that matches the area you are reviewing.",
          "Confirm the room has enough as-is photography to quote responsibly.",
        ],
      },
      {
        id: "photos-to-intent",
        title: "Move from existing-condition photos to design intent",
        summary: "The contractor should understand both the current room and the target feel before suggesting solutions.",
        paragraphs: [
          "Listing photos describe the real room. Inspiration photos, reviews, and mood boards describe what the homeowner wants the room to become. Both are needed before you can recommend sequence, alternates, or price-sensitive adjustments.",
          "Decision Room then puts those visual layers together so a contractor can assess whether the target feels feasible in that space and what supporting scope might be missing.",
        ],
        bullets: [
          "Review lighting, layout, and constraints in the listing photos.",
          "Compare finish intent in inspiration and decision candidates.",
          "Look for missing details that affect labor or sequencing.",
        ],
      },
      {
        id: "pricing-constraints",
        title: "Carry room constraints back into the quote",
        summary: "The value of room review is that it produces better estimate inputs.",
        paragraphs: [
          "After room review, a contractor should be able to say whether the homeowner's target is realistic at the current budget, whether alternates are needed, and whether the room still has hidden unknowns.",
          "This is also the right moment to recommend trade-discount substitutions or construction clarifications, because the recommendation is grounded in the room evidence instead of floating free in email.",
        ],
        bullets: [
          "Note which selections are good enough to price now.",
          "Flag anything that still needs an allowance, site confirmation, or alternate pricing path.",
          "Use supporting documents to back up material or scope feedback.",
        ],
      },
    ],
  },
  {
    slug: ["contractors", "estimates-and-contracts"],
    href: "/docs/contractors/estimates-and-contracts",
    shortTitle: "Estimates and contracts",
    title: "Contractor Estimates and Contracts",
    audience: "contractors",
    audienceLabel: "For Contractors",
    status: "live",
    summary: "Track revisions, connect pricing back to rooms, and carry approved scope into contracts with audit history intact.",
    overview:
      "After the project brief is understood, the estimate and contract workspaces become the structured record for pricing, negotiation, and agreement management. These screens are meant to preserve revision history rather than replacing one version with another and losing the why.",
    highlights: [
      "Estimate intake captures draft and submitted revisions with supporting documents.",
      "Room mappings help pricing stay tied to real project areas.",
      "Contracts extend the same revision-safe approach into obligations, risk notes, and payment controls.",
    ],
    actions: [
      {
        href: "/admin/estimates",
        label: "Open Estimates",
        description: "Review estimate lists, revisions, and current pricing snapshots.",
      },
      {
        href: "/admin/estimates/new",
        label: "Open Estimate Intake",
        description: "Create a new draft or submitted estimate revision.",
      },
      {
        href: "/admin/contracts",
        label: "Open Contracts",
        description: "Track contract revisions, findings, and payment milestones.",
      },
    ],
    sections: [
      {
        id: "estimate-revisions",
        title: "Record estimate revisions instead of overwriting them",
        summary: "Pricing changes are part of the project story and should stay inspectable.",
        paragraphs: [
          "The estimates workspace is designed to keep revision history visible. That makes it easier to compare how totals changed, what documents supported a revision, and whether the current bid still reflects the latest homeowner direction.",
          "This matters when multiple contractors are bidding because revision timing can affect fairness and the homeowner's interpretation of the numbers.",
        ],
        bullets: [
          "Create a new revision when pricing or scope changes materially.",
          "Attach source documents when a revision depends on new evidence.",
          "Use the revision list to explain changes instead of asking the homeowner to remember them.",
        ],
      },
      {
        id: "room-mapping",
        title: "Use room mappings and attached documents",
        summary: "Estimates are easier to trust when the priced work is tied back to rooms and source evidence.",
        paragraphs: [
          "Room mapping helps the contractor and homeowner answer a simple question: which part of the house does this price belong to? That is especially important when the remodel covers several rooms with different priorities and option levels.",
          "Supporting documents, extracted source content, and attached files turn a bid into something the homeowner can review with more confidence.",
        ],
        bullets: [
          "Map revisions or line-item groups back to rooms whenever possible.",
          "Link quote evidence so the homeowner can inspect the source context.",
          "Use the same room language the homeowner sees elsewhere in the app.",
        ],
      },
      {
        id: "contract-control",
        title: "Turn winning bids into contract control",
        summary: "Contracts should inherit the same discipline as the estimate history.",
        paragraphs: [
          "Once scope stabilizes, contract records let the team capture risk findings, payment structures, and milestone obligations without losing connection to the earlier pricing context.",
          "That makes the contract area more useful than a flat file vault. It becomes the structured record for what was agreed, what was flagged, and what still needs follow-up.",
        ],
        bullets: [
          "Keep contract revisions separate when the terms change materially.",
          "Document risk findings and open issues alongside the contract record.",
          "Use the same system to trace from room intent to estimate to contract.",
        ],
      },
    ],
  },
];

const sharedPages: DocsPageDefinition[] = [
  {
    slug: ["shared", "decision-trace"],
    href: "/docs/shared/decision-trace",
    shortTitle: "Decision trace",
    title: "Shared Decision Trace",
    audience: "shared",
    audienceLabel: "Shared Workflow",
    status: "live",
    summary: "Keep every major room decision attached to visual evidence, documents, and revision history.",
    overview:
      "A remodel becomes hard to manage when decisions get separated from the reasons behind them. The shared decision trace in this app depends on supporting documents, reviewed images, and promoted room candidates staying connected instead of living in disconnected folders.",
    highlights: [
      "Supporting documents store the evidence behind scope and selection choices.",
      "Decision Room promotes candidate visuals that can anchor room discussions.",
      "Revision-safe history helps both sides understand why the project moved.",
    ],
    actions: [
      {
        href: "/supporting-docs",
        label: "Open Supporting Documents",
        description: "Review evidence, file versions, and room-linked artifacts.",
      },
      {
        href: "/review",
        label: "Open Photo Reviews",
        description: "Review inspirational images and target design direction.",
      },
      {
        href: "/decision-room",
        label: "Open Decision Room",
        description: "Compare and promote room-ready visual candidates.",
      },
    ],
    sections: [
      {
        id: "evidence",
        title: "Keep every decision attached to evidence",
        summary: "Files, screenshots, quotes, and notes should explain why a choice exists.",
        paragraphs: [
          "Supporting documents are not just storage. They are the evidence layer for product links, source quotes, permits, screenshots, and planning artifacts that explain what the homeowner is asking for and what the contractor is reacting to.",
          "When a material or scope choice changes, keeping the supporting evidence visible makes it easier to understand whether the change came from cost, feasibility, lead time, or preference.",
        ],
        bullets: [
          "Attach the source behind each major material or scope decision.",
          "Tag documents to rooms, scenarios, or planning nodes when relevant.",
          "Prefer explicit evidence over vague references in messages.",
        ],
      },
      {
        id: "promoted-candidates",
        title: "Use promoted visuals to show direction",
        summary: "Promoted candidates make it clear which images are active contenders instead of loose inspiration.",
        paragraphs: [
          "Decision Room compares listing photos, inspiration, and AI render candidates so the team can decide what should move forward. Promoted images become the clearest visual shorthand for where a room is heading.",
          "That is useful during contractor discussions because it reduces the chance that someone is pricing against the wrong reference image.",
        ],
        bullets: [
          "Promote only the images that meaningfully represent the current room direction.",
          "Keep room notes updated when a promoted image becomes outdated.",
          "Use camera anchors and room context to keep visual comparisons grounded.",
        ],
      },
      {
        id: "history",
        title: "Preserve revision history instead of rewriting context",
        summary: "A running remodel record is more trustworthy when it shows what changed and why.",
        paragraphs: [
          "This app already uses revision-aware patterns in documents, estimates, and contracts. The same philosophy should guide room decisions: preserve a trail of how the homeowner and contractor converged on a decision.",
          "That history reduces confusion later when construction begins and someone needs to verify which option was approved, priced, or deferred.",
        ],
        bullets: [
          "Do not treat the latest choice as though earlier choices never existed.",
          "Use revisions to explain decision movement over time.",
          "Keep the evidence trail readable for anyone joining the project later.",
        ],
      },
    ],
  },
  {
    slug: ["shared", "collaboration-loop"],
    href: "/docs/shared/collaboration-loop",
    shortTitle: "Collaboration loop",
    title: "Homeowner and Contractor Collaboration Loop",
    audience: "shared",
    audienceLabel: "Shared Workflow",
    status: "live",
    summary: "Understand how the app is meant to support the full loop from first brief through estimates, contracts, and ongoing room clarification.",
    overview:
      "The product goal is to be a one-stop shop during the remodel, not just a gallery or a budget sheet. Homeowners feed the system with room goals, visuals, budget signals, and documents. Contractors review that information, respond with pricing and guidance, and help tighten the brief until it is buildable.",
    highlights: [
      "The app is meant to support repeated homeowner-contractor revision cycles.",
      "Multiple contractors should be able to review the same core brief for fairer estimate comparison.",
      "The room-aware questionnaire surfaces missing build questions while the room brief evolves.",
    ],
    actions: [
      {
        href: "/",
        label: "Open Mission Control",
        description: "See the current shared entry point for the project.",
      },
      {
        href: "/budget-tracker",
        label: "Open Budget Tracker",
        description: "Review how budget decisions evolve with the collaboration loop.",
      },
      {
        href: "/admin/estimates",
        label: "Open Estimates",
        description: "See where contractor responses become structured pricing revisions.",
      },
    ],
    sections: [
      {
        id: "loop-overview",
        title: "How the homeowner-to-contractor loop should work",
        summary: "The homeowner enters intent, the contractor reacts, and both sides refine the brief.",
        paragraphs: [
          "A homeowner starts by entering room goals, initial budgets, existing-condition photos, and inspiration. That creates enough context for a contractor to understand the house and begin responding with clarifications, pricing, and feasibility feedback.",
          "The homeowner then revises the brief using what they learned. The cycle repeats until the rooms, materials, and budget direction are clear enough to support a dependable estimate and later a contract.",
        ],
        bullets: [
          "The first version of the brief is expected to be incomplete.",
          "Each contractor response should make the next homeowner revision smarter.",
          "The app works best when every revision stays in the same workspace.",
        ],
      },
      {
        id: "multi-contractor",
        title: "Support multi-contractor estimating",
        summary: "The shared workspace should make it easier to get multiple estimates without rewriting the project every time.",
        paragraphs: [
          "Best practice is to gather more than one estimate. That only works well if each contractor sees a comparable version of the project brief. The app is meant to preserve that consistency by keeping rooms, documents, and budget context centralized.",
          "Contractor-specific pricing can diverge later in the estimate workspace, but the underlying homeowner brief should remain readable and stable across bidders.",
        ],
        bullets: [
          "Keep the homeowner-facing project brief consistent across bidders.",
          "Use estimate revisions to capture contractor-specific responses.",
          "Document when scope changes so bidders can react to the same new information.",
        ],
      },
      {
        id: "in-progress-capabilities",
        title: "Capabilities still in progress",
        summary: "Some of the collaboration model is already present, and some of it is explicitly planned next.",
        paragraphs: [
          "The current product already covers room visuals, budget tracking, supporting documents, decision comparisons, estimates, and contracts. The upcoming questionnaire workflow extends that system by surfacing room-specific build questions before they become change orders or missed scope.",
          "That planned addition fits the existing architecture because the contractor should eventually see questionnaire answers inside the same room context used for photos, documents, and budget review.",
        ],
        bullets: [
          "Questionnaire answers are intended to be room-linked.",
          "AI should propose relevant prompts while the homeowner is already editing room context.",
          "The contractor room view should eventually include those answers alongside the rest of the room brief.",
        ],
        note: {
          title: "Planned extension",
          body: "The questionnaire flow is documented here so the collaboration model is explicit now, even though that standalone surface is still being developed.",
          tone: "planned",
        },
      },
    ],
  },
];

/**
 * Platform & Systems docs — how the deep-research sourcing engine actually
 * works, what it does today, and where it's headed. Authored to give the
 * operator a precise mental model (with Mermaid diagrams) before extending it.
 */
const platformPages: DocsPageDefinition[] = [
  {
    slug: ["platform", "deep-research-overview"],
    href: "/docs/platform/deep-research-overview",
    shortTitle: "Deep research sourcing",
    title: "Deep Research Sourcing — Overview",
    audience: "platform",
    audienceLabel: "Platform & Systems",
    status: "live",
    summary:
      "What the deep-research sourcing engine is for, what it researches, and the artifacts it produces against the showroom data model.",
    overview:
      "Deep research sourcing turns a question about a material, product, or showroom into traceable, citation-backed artifacts in D1. You point it at a target — a generic material such as kitchen stone, a product you already track, an individual showroom, or an under-covered category — and it gathers price signals, ratings, gotchas, specs, and imagery, then stores them against that target so the rest of the app can use them.",
    highlights: [
      "Four research targets: material, tracked product, showroom, and category gap.",
      "Outputs are findings (with sentiment), specs, scraped images, review sources, and RAG vectors.",
      "Every artifact is bound to a specific D1 entity so it shows up in that entity's view.",
      "The Sourcing Research console is the human surface for launching and reviewing sweeps.",
    ],
    actions: [
      {
        href: "/admin/showroom/sourcing",
        label: "Open Sourcing Research",
        description: "Stage a prompt, launch a sweep, and review findings and media.",
      },
      {
        href: "/admin/showroom",
        label: "Showroom Dashboard",
        description: "Browse the showrooms and products that sweeps write against.",
      },
    ],
    sections: [
      {
        id: "what-it-researches",
        title: "What it researches",
        summary: "The four targets and the artifacts each sweep produces.",
        paragraphs: [
          "A sweep always has one explicit target. That target is chosen before the sweep starts, which is why every fact the sweep discovers is filed against the correct entity by construction rather than guessed at afterward.",
          "Regardless of target, the sweep produces the same shape of output: short findings tagged positive, negative, or neutral; structured specs; scraped images uploaded to Cloudflare Images; review-platform ratings used as sources; and vector embeddings for retrieval.",
        ],
        diagrams: [
          {
            code: `flowchart TD
    M["Material (e.g. kitchen stone)"] --> Sweep
    P["Tracked product"] --> Sweep
    S["Showroom / store"] --> Sweep
    C["Under-covered category"] --> Sweep
    Sweep(["Deep research sweep"])
    Sweep --> F["Findings — price, ratings, gotchas"]
    Sweep --> Sp["Specs"]
    Sweep --> Img["Product / storefront images"]
    Sweep --> R["Review-source ratings"]
    Sweep --> V["Vector embeddings (RAG)"]`,
            caption: "Any of four targets flows through one sweep into five kinds of artifact.",
          },
        ],
        bullets: [
          "Material: research a generic material first, then use it to source candidate products and showrooms.",
          "Product: refresh pricing, sales, reviews, and specs on something you already track.",
          "Showroom: gather reputation, return policy, delivery reliability, and storefront imagery.",
          "Category gap: the cron path — find alternatives when a category has thin or rejected coverage.",
        ],
      },
      {
        id: "data-model",
        title: "Where the artifacts land",
        summary: "The showroom tables a sweep reads and writes.",
        paragraphs: [
          "Findings, specs, and images are written against the specific store or product the sweep targeted. Homeowner ratings are the only approval signal today, and they live at the store and product level.",
          "The two research-context read endpoints added with the Sourcing Research console expose these rows to the frontend so the ledger and galleries render live data.",
        ],
        diagrams: [
          {
            code: `erDiagram
    showroom_stores ||--o{ showroom_store_products : has
    showroom_stores ||--o{ store_research : findings
    showroom_stores ||--o{ showroom_images : storefront
    showroom_stores ||--o{ showroom_store_ratings : sources
    showroom_stores ||--o{ store_rating : homeowner
    showroom_store_products ||--o{ store_product_research : findings
    showroom_store_products ||--o{ product_images : imagery
    showroom_store_products ||--o{ product_specs : specs
    showroom_store_products ||--o{ store_product_rating : homeowner`,
            caption: "Showroom sourcing data model — findings, images, specs, and ratings hang off stores and products.",
          },
        ],
        note: {
          title: "Approval today is store-level only",
          body: "There is no per-finding or per-image approval column yet. The only human approval signal is a store or product rating. The roadmap page covers the planned fact-level and image-level review gates.",
          tone: "planned",
        },
      },
    ],
  },
  {
    slug: ["platform", "sourcing-pipeline"],
    href: "/docs/platform/sourcing-pipeline",
    shortTitle: "Sourcing pipeline (as-built)",
    title: "Sourcing Pipeline — As Built",
    audience: "platform",
    audienceLabel: "Platform & Systems",
    status: "live",
    summary:
      "The exact pipeline that runs today: prompt staging, citation discovery, Browser Rendering extraction, persistence, and the autonomous cron monitor.",
    overview:
      "Today's pipeline is a single-shot autonomous run. After an optional prompt-staging step, the agent discovers citation URLs (via Gemini deep research or a quick Flash JSON call), extracts structured data from each source with Browser Rendering, uploads imagery to Cloudflare Images, and writes everything to D1 and Vectorize. There is no plan-review pause and no per-artifact gate — the only human review is rating a showroom after the fact.",
    highlights: [
      "Prompt staging uses Llama 3.3 to draft a product-specific brief you can edit.",
      "Citation discovery uses Gemini deep research (deep) or Gemini Flash JSON (quick).",
      "Browser Rendering extractJson structures findings, specs, images, and ratings.",
      "Images are content-type validated and capped at 4 per source — no relevance filter.",
      "A per-minute cron sweeps categories that are thin or fully rejected.",
    ],
    actions: [
      {
        href: "/admin/showroom/sourcing",
        label: "Open Sourcing Research",
        description: "Run a sweep and watch the artifacts land.",
      },
    ],
    sections: [
      {
        id: "sweep-pipeline",
        title: "The sweep pipeline",
        summary: "From prompt to persisted artifacts, end to end.",
        paragraphs: [
          "The frontend can first call the draft-prompt endpoint to stage an editable brief. Launching a sweep dispatches the ShowroomResearchAgent by RPC. The agent discovers citations, then loops over each source URL extracting structured data and imagery before persisting and embedding.",
          "Note the absence of any pause: the citation plan flows straight into scraping and persistence. The only review is the homeowner rating applied afterward in the Review Ledger.",
        ],
        diagrams: [
          {
            code: `sequenceDiagram
    actor U as Homeowner
    participant FE as Sourcing UI
    participant API as Hono API
    participant AG as ShowroomResearchAgent
    participant G as Gemini (AI Gateway)
    participant BR as Browser Rendering
    participant IMG as Cloudflare Images
    participant D1 as D1
    participant VEC as Vectorize
    U->>FE: Stage prompt (optional)
    FE->>API: POST draft-prompt
    API->>AG: generateProductDraftPrompt (Llama 3.3)
    AG-->>FE: prompt text
    U->>FE: Launch sweep (quick or deep)
    FE->>API: POST deep-sweep
    API->>AG: deepSweep* (RPC)
    AG->>G: Discover citations
    G-->>AG: citation URLs
    loop per source URL
        AG->>BR: extractJson + extractMarkdown
        BR-->>AG: findings, specs, images, ratings
        AG->>IMG: upload scraped images
        AG->>D1: insert findings / specs / images
        AG->>VEC: embed summary chunks
    end
    AG-->>FE: counts`,
            caption: "As-built sweep — no plan review, no per-artifact gate. Review is store-level rating after the fact.",
          },
        ],
      },
      {
        id: "cron-monitor",
        title: "Autonomous cron monitor",
        summary: "How thin or rejected categories trigger sweeps on their own.",
        paragraphs: [
          "A per-minute scheduled handler checks each active category. It fires a category sweep when coverage is thin (at most one mapped showroom) or when every mapped showroom has been rejected by a homeowner rating of one or lower. The reasons attached to those low ratings become negative constraints for the next sweep.",
          "Sweeps are throttled per category for 24 hours and limited to one per tick, so the loop nudges coverage forward without runaway cost.",
        ],
        diagrams: [
          {
            code: `flowchart TD
    T["Cron tick — every minute"] --> M["monitorShowroomSourcingCoverage"]
    M --> Q{"For each active category"}
    Q --> G{"<= 1 showroom OR all rated <= 1?"}
    G -- no --> Skip["Skip"]
    G -- yes --> Th{"Throttled in last 24h?"}
    Th -- yes --> Skip
    Th -- no --> NC["Build negative constraints from ratingNotes"]
    NC --> Sweep["deepSweepCategory"]
    Sweep --> One["Max 1 sweep per tick"]`,
            caption: "The rejection loop: a ruled-out showroom's reason feeds the next autonomous category sweep.",
          },
        ],
      },
    ],
  },
  {
    slug: ["platform", "sourcing-hitl-roadmap"],
    href: "/docs/platform/sourcing-hitl-roadmap",
    shortTitle: "HITL review & roadmap",
    title: "HITL Review & Roadmap — Intended Flow",
    audience: "platform",
    audienceLabel: "Platform & Systems",
    status: "planned",
    summary:
      "The intended human-in-the-loop flow: a reviewable research plan with agent annotations, structured fact parsing with entity matching, and per-fact and per-image approval gates.",
    overview:
      "The intended flow adds review gates the current pipeline skips. Gemini should return a research plan, the onboard worker agent should annotate that plan with its own notes, and the operator should iterate to approval. Once the findings report comes back, Workers AI should parse it against a structured schema and match each fact to the right entity — and because that matching can be wrong, every fact and every scraped image should be approved or rejected by a human before it sticks.",
    highlights: [
      "Plan review: Gemini proposes a plan; the worker agent appends its review notes.",
      "Iterative approval: the operator edits and re-runs the plan until it is approved.",
      "Structured parse: Workers AI converts the findings report into typed facts.",
      "Entity matching: each fact is proposed against a product, material, or showroom.",
      "Per-fact and per-image HITL: approve correct matches, reject wrong ones and junk imagery.",
    ],
    actions: [
      {
        href: "/admin/showroom/sourcing",
        label: "Open Sourcing Research",
        description: "Where the review gates will live.",
      },
    ],
    sections: [
      {
        id: "intended-flow",
        title: "Intended end-to-end flow",
        summary: "Plan review, structured parse, entity matching, and approval gates.",
        paragraphs: [
          "Gemini returns a proposed research plan instead of running straight through. The worker agent reviews that plan and appends its own thoughts, so the operator sees both the plan and the agent's annotations. The operator can request changes and iterate before approving.",
          "After approval, the findings report is parsed by Workers AI into a structured schema and each fact is matched to a candidate entity. Because that matching is imperfect, the operator confirms or rejects each fact, and separately confirms or rejects each scraped image so spam and mismatched assets never persist.",
        ],
        diagrams: [
          {
            code: `sequenceDiagram
    actor U as Homeowner
    participant AG as Worker Agent
    participant G as Gemini Deep Research
    participant WAI as Workers AI (structured)
    participant BR as Browser Rendering
    participant D1 as D1
    U->>G: Kick off research brief
    G-->>AG: Proposed research plan
    AG->>AG: Review plan, append notes
    AG-->>U: Plan + agent annotations
    U->>AG: Edit / request changes
    Note over U,AG: Iterate until approved (gate 1)
    U->>G: Approve and run
    G-->>WAI: Findings report
    WAI->>WAI: Structured parse + entity match
    WAI-->>U: Proposed facts
    U->>D1: Approve / reject each fact (gate 2)
    AG->>BR: Scrape candidate images
    BR-->>U: Image candidates
    U->>D1: Approve / reject each image (gate 3)`,
            caption: "Intended flow with three human gates: plan approval, per-fact review, and per-image review.",
          },
        ],
      },
      {
        id: "review-lifecycle",
        title: "Review lifecycle of a fact or image",
        summary: "The state a proposed artifact moves through under HITL.",
        paragraphs: [
          "Under the intended model, every parsed fact and scraped image starts pending. The operator approves it — applying it to the matched entity — or rejects it. Rejections are not wasted: a rejected showroom or finding feeds the negative constraints that tune future sweeps, the same mechanism the cron rejection loop already uses.",
        ],
        diagrams: [
          {
            code: `stateDiagram-v2
    [*] --> Pending: AI proposes fact or image
    Pending --> Approved: Homeowner approves
    Pending --> Rejected: Wrong entity or junk
    Approved --> Applied: Written to entity
    Rejected --> Constraints: Feeds negative constraints
    Applied --> [*]
    Constraints --> [*]`,
            caption: "A proposed artifact's lifecycle — approval applies it, rejection sharpens the next sweep.",
          },
        ],
      },
      {
        id: "gap-analysis",
        title: "Gap analysis — built vs. intended",
        summary: "What exists today and what the intended flow still needs.",
        paragraphs: [
          "The list below marks each intended step against the current implementation so the work is explicit.",
        ],
        bullets: [
          "Gemini returns a reviewable plan — NOT BUILT. Deep research runs straight through; collaborative planning is off.",
          "Worker agent annotates the plan — NOT BUILT. No code reads a plan or appends agent notes.",
          "Iterative HITL plan approval — NOT BUILT. There is no plan-approval route, table, or UI.",
          "Structured findings parse — PARTIAL. Structuring happens via Browser Rendering extractJson and Gemini JSON, not a dedicated Workers AI structured parse.",
          "Entity matching of facts — NOT BUILT. The target id is fixed up front; facts are bound by construction.",
          "Image scraping — BUILT. Images upload to Cloudflare Images and index in D1, but with no relevance or spam filter.",
          "Per-fact and per-image approve/reject — NOT BUILT. No approval column exists; only store-level rating does.",
        ],
        note: {
          title: "What this unlocks next",
          body: "Per-fact and per-image review needs a small schema addition (a review-status column on the findings and image tables) plus an approval endpoint and ledger controls. The plan-review gate needs Gemini collaborative planning plus an agent annotation step. These are the next increments, documented here so the target is explicit.",
          tone: "planned",
        },
      },
    ],
  },
];

export const docsAudienceGroups: DocsAudienceGroup[] = [
  {
    id: "homeowners",
    title: "For Homeowners",
    summary: "Plan scope, capture visual intent, and give contractors a clear project brief to react to.",
    pages: homeownersPages,
  },
  {
    id: "contractors",
    title: "For Contractors",
    summary: "Review the brief, inspect rooms, price responsibly, and keep revisions tied to the underlying evidence.",
    pages: contractorsPages,
  },
  {
    id: "shared",
    title: "Shared Workflows",
    summary: "Understand the common decision trail that should survive from first concept through pricing and agreement.",
    pages: sharedPages,
  },
  {
    id: "platform",
    title: "Platform & Systems",
    summary: "How the deep-research sourcing engine works under the hood — what runs today and the intended human-in-the-loop roadmap.",
    pages: platformPages,
  },
];

export const docsPages: DocsPageDefinition[] = docsAudienceGroups.flatMap((group) => group.pages);

export function getDocsPageBySlug(slug: string | string[] | undefined): DocsPageDefinition | null {
  const normalized = Array.isArray(slug)
    ? slug
    : typeof slug === "string" && slug.length > 0
      ? slug.split("/")
      : [];

  return docsPages.find((page) => page.slug.join("/") === normalized.join("/")) || null;
}

export function getDocsPageByPath(pathname: string): DocsPageDefinition | null {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return docsPages.find((page) => page.href === normalized) || null;
}

export function getDocsAudienceGroup(audienceId: DocsAudienceId): DocsAudienceGroup | null {
  return docsAudienceGroups.find((group) => group.id === audienceId) || null;
}
