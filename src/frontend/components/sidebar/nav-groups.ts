import type { NavGroupDef } from "./shared";

/**
 * The full sidebar information architecture, ordered top-to-bottom. Split at
 * render time by the `admin` flag: the AdminSidebar renders the `admin: true`
 * groups (URLs under `/admin/*`), the PublicSidebar renders the `admin: false`
 * groups (user-facing root pages). Only the section containing the active route
 * expands by default (see `useOpenNavGroups`). The full shopping toolset lives
 * on the `/admin/shopping` hub landing — the sidebar surfaces only the
 * high-traffic few.
 */
export const NAV_GROUPS: NavGroupDef[] = [
  {
    id: "plan",
    label: "Plan",
    admin: true,
    items: [
      { href: "/admin/planning/measure", label: "Live Floor Plan" },
      { href: "/admin/measurements", label: "Measurements" },
      { href: "/admin/designs/workshop", label: "Design Workshop" },
      { href: "/admin/designs/moodboards", label: "Mood Boards" },
      { href: "/admin/designs/decision-room", label: "Decision Room" },
    ],
  },
  {
    id: "budget",
    label: "Budget",
    admin: true,
    items: [
      { href: "/admin/budget/tracker", label: "Budget Tracker" },
      { href: "/admin/budget/dashboard", label: "Budget Triage Matrix" },
      { href: "/admin/budget/truth-table", label: "Labor & Materials Costs" },
    ],
  },
  {
    id: "contractors",
    label: "Contractors",
    admin: true,
    items: [
      { href: "/admin/inbox/all", label: "All Inboxes" },
      { href: "/admin/inbox", label: "Email Inbox" },
      { href: "/admin/inbox/gmail", label: "Gmail Inbox" },
      { href: "/admin/companies", label: "Companies" },
      { href: "/admin/estimates", label: "Estimates" },
      { href: "/admin/contracts", label: "Contracts" },
      { href: "/admin/bids", label: "Bid Portfolios" },
      { href: "/admin/pmo/schedule/contractor", label: "Schedule" },
      { href: "/admin/tasks", label: "Tasks" },
      { href: "/admin/permits", label: "Permits" },
      { href: "/admin/dialer", label: "Prospect Dialer" },
    ],
  },
  {
    id: "shopping",
    label: "Shopping & Sourcing",
    admin: true,
    items: [
      { href: "/admin/shopping", label: "Sourcing & Shopping tools" },
      { href: "/admin/shopping/showrooms", label: "Showrooms" },
      { href: "/admin/shopping/drives", label: "Showroom Drives" },
      { href: "/admin/shopping/schedule", label: "Materials Schedule" },
      { href: "/admin/shopping/products", label: "Products" },
      { href: "/admin/shopping/photo-intake", label: "Showroom Intake" },
      { href: "/admin/shopping/photo-review", label: "Price-Card Review" },
      { href: "/admin/shopping/wishlist", label: "Wishlist" },
      { href: "/admin/shopping/journal", label: "Shopping Journal" },
      { href: "/admin/shopping/research", label: "Deep Research" },
    ],
  },
  {
    id: "photos",
    label: "Photos & Renders",
    admin: true,
    items: [
      { href: "/admin/prepare/uploads", label: "Uploads" },
      { href: "/admin/prepare/review", label: "Review" },
      { href: "/admin/photo-edits", label: "Photo Edits" },
      { href: "/admin/prepare/blank-canvas", label: "Blank Canvas" },
      { href: "/admin/builder", label: "Renovation Studio" },
      { href: "/admin/gallery", label: "Render Gallery" },
    ],
  },
  {
    id: "documents",
    label: "Documents & Research",
    admin: true,
    items: [
      { href: "/admin/docs", label: "Documents" },
      { href: "/admin/docs/views", label: "Doc Views" },
      { href: "/admin/supporting-docs", label: "Supporting Docs" },
      { href: "/admin/planning/research", label: "Research Library" },
    ],
  },
  {
    id: "system",
    label: "System",
    admin: true,
    items: [
      { href: "/admin", label: "Analytics" },
      { href: "/admin/plans", label: "Plans" },
      { href: "/admin/studio", label: "Studio" },
      { href: "/admin/mcp-ops", label: "MCP Ops" },
      { href: "/admin/integrations/usage", label: "Integrations Usage" },
      { href: "/admin/config", label: "Config" },
      { href: "/config/photo/categories", label: "Configuration" },
    ],
  },
  {
    id: "home-tour",
    label: "Home Tour",
    admin: false,
    items: [
      { href: "/floor-plan", label: "Floor Plan" },
      { href: "/kitchen-layout", label: "Kitchen Layout" },
      { href: "/photos/listing", label: "Listing Photos" },
      { href: "/photos/inspiration", label: "Inspiration Photos" },
    ],
  },
  {
    id: "records",
    label: "Records",
    admin: false,
    items: [
      { href: "/docs", label: "Documents" },
      { href: "/supporting-docs", label: "Project Records" },
    ],
  },
];

/** The `admin: true` groups, in order — rendered by the AdminSidebar. */
export const ADMIN_NAV_GROUPS = NAV_GROUPS.filter((group) => group.admin);

/** The `admin: false` groups, in order — rendered by the PublicSidebar. */
export const PUBLIC_NAV_GROUPS = NAV_GROUPS.filter((group) => !group.admin);
