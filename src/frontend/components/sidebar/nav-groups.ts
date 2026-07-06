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
      { href: "/admin/measure", label: "Live Floor Plan" },
      { href: "/admin/measurements", label: "Measurements" },
      { href: "/admin/planning/moodboards", label: "Mood Boards" },
      { href: "/admin/planning/decision-room", label: "Decision Room" },
    ],
  },
  {
    id: "budget",
    label: "Budget",
    admin: true,
    items: [
      { href: "/admin/budget-tracker", label: "Budget Tracker" },
      { href: "/admin/budget-dashboard", label: "Budget Triage Matrix" },
      { href: "/admin/truth-table", label: "Labor & Materials Costs" },
    ],
  },
  {
    id: "contractors",
    label: "Contractors",
    admin: true,
    items: [
      { href: "/admin/companies", label: "Companies" },
      { href: "/admin/estimates", label: "Estimates" },
      { href: "/admin/contracts", label: "Contracts" },
      { href: "/admin/bid-portfolios", label: "Bid Portfolios" },
      { href: "/admin/contractor-schedule", label: "Schedule" },
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
      { href: "/admin/shopping/schedule", label: "Materials Schedule" },
      { href: "/admin/shopping/products", label: "Products" },
      { href: "/admin/shopping/journal", label: "Shopping Journal" },
      { href: "/admin/shopping/research", label: "Deep Research" },
    ],
  },
  {
    id: "photos",
    label: "Photos & Renders",
    admin: true,
    items: [
      { href: "/admin/uploads", label: "Uploads" },
      { href: "/admin/review", label: "Review" },
      { href: "/admin/photo-edits", label: "Photo Edits" },
      { href: "/admin/blank-canvas", label: "Blank Canvas" },
      { href: "/admin/builder", label: "Renovation Studio" },
      { href: "/admin/gallery", label: "Render Gallery" },
    ],
  },
  {
    id: "documents",
    label: "Documents & Research",
    admin: true,
    items: [
      { href: "/admin/supporting-docs", label: "Supporting Docs" },
      { href: "/admin/research", label: "Research Library" },
    ],
  },
  {
    id: "system",
    label: "System",
    admin: true,
    items: [
      { href: "/admin", label: "Analytics" },
      { href: "/admin/plans", label: "Plans" },
      { href: "/admin/integrations/usage", label: "Integrations Usage" },
      { href: "/admin/config", label: "Config" },
    ],
  },
  {
    id: "home-tour",
    label: "Home Tour",
    admin: false,
    items: [
      { href: "/floor-plan", label: "Floor Plan" },
      { href: "/kitchen-layout", label: "Kitchen Layout" },
      { href: "/listing-photos", label: "Listing Photos" },
      { href: "/inspiration-photos", label: "Inspiration Photos" },
    ],
  },
  {
    id: "records",
    label: "Records",
    admin: false,
    items: [
      { href: "/supporting-docs", label: "Project Records" },
    ],
  },
];

/** The `admin: true` groups, in order — rendered by the AdminSidebar. */
export const ADMIN_NAV_GROUPS = NAV_GROUPS.filter((group) => group.admin);

/** The `admin: false` groups, in order — rendered by the PublicSidebar. */
export const PUBLIC_NAV_GROUPS = NAV_GROUPS.filter((group) => !group.admin);
