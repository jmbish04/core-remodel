export type DocsAudienceId = "homeowners" | "contractors" | "shared";
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

export interface DocsSectionDefinition {
  id: string;
  title: string;
  summary: string;
  paragraphs: string[];
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
        href: "/estimates",
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
    status: "planned",
    summary: "Planned guidance for the upcoming room questionnaire that surfaces build questions before they become costly misses.",
    overview:
      "This guide documents the intended questionnaire workflow for the product. It is included now so the documentation suite explains the coming collaboration model even before the standalone questionnaire page is fully shipped.",
    highlights: [
      "The questionnaire is meant to be room-aware, not a giant one-time form.",
      "Answers should help contractors catch hidden scope, wiring, blocking, and finish implications.",
      "AI is expected to flag relevant questions as the homeowner adds room context and photos.",
    ],
    actions: [
      {
        href: "/docs/shared/collaboration-loop",
        label: "Read Collaboration Loop",
        description: "See how questionnaire answers are meant to feed contractor review and pricing.",
      },
    ],
    sections: [
      {
        id: "why-questionnaire",
        title: "Why the questionnaire exists",
        summary: "The goal is to prevent expensive omissions before construction begins.",
        paragraphs: [
          "Many remodel decisions are not obvious from photos alone. A homeowner may want a television wall, under-cabinet lighting, extra blocking, future speakers, or a niche that affects framing and electrical work even if they do not know how to ask for it.",
          "The questionnaire is intended to bring those build-sensitive questions into the process early enough that contractors can account for them in scope and pricing.",
        ],
        bullets: [
          "Expect yes or no prompts that reveal hidden construction needs.",
          "Tie answers to rooms whenever possible.",
          "Use the answers to sharpen estimates, not to replace contractor judgment.",
        ],
        note: {
          title: "Planned workflow",
          body: "This documentation reflects the intended standalone questionnaire page and room-linked answer flow. The product direction is documented here even if the final interface is still being built.",
          tone: "planned",
        },
      },
      {
        id: "room-context",
        title: "Answer questions in room context",
        summary: "Questions should appear where the homeowner is already thinking about that room.",
        paragraphs: [
          "A bathroom, bedroom, kitchen, and media wall do not need the same prompts. The questionnaire is meant to feel lighter because answers can be provided while the homeowner is already reviewing photos, budget, and notes for a room.",
          "That makes the process less overwhelming than forcing the user through one giant intake checklist before the rest of the app becomes useful.",
        ],
        bullets: [
          "Associate each answer with one or more rooms.",
          "Allow a homeowner to answer incrementally as decisions become clearer.",
          "Show the answers later in the contractor's room review context.",
        ],
      },
      {
        id: "ai-flagging",
        title: "Use AI to surface the right prompts at the right time",
        summary: "Question relevance should come from the room data the homeowner is already entering.",
        paragraphs: [
          "The intended AI behavior is to watch the room brief, visual references, and uploaded materials, then flag questionnaire prompts that appear relevant. A media-wall reference might trigger blocking and power questions. A shower layout might trigger waterproofing, niche, or fixture questions.",
          "That keeps the user moving through the remodel room by room while still capturing the construction decisions a contractor needs to quote responsibly.",
        ],
        bullets: [
          "AI should propose relevant prompts, not interrupt every workflow.",
          "Triggered questions should still be reviewable and editable by the homeowner.",
          "Contractors should see the resulting answers inside the room context they are pricing.",
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
        href: "/estimates",
        label: "Open Estimates",
        description: "Review estimate lists, revisions, and current pricing snapshots.",
      },
      {
        href: "/estimates/new",
        label: "Open Estimate Intake",
        description: "Create a new draft or submitted estimate revision.",
      },
      {
        href: "/contracts",
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
      "Planned questionnaire guidance is meant to surface missing build questions while the room brief evolves.",
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
        href: "/estimates",
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
