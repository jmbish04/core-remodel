export type SiteConfig = {
  name: string;
  description: string;
  url: string;
  author: {
    name: string;
    url: string;
  };
  links: {
    github: string;
  };
  navItems: {
    href: string;
    label: string;
    external?: boolean;
  }[];
};

export const siteConfig: SiteConfig = {
  name: "126 Colby - Remodel Mission Control",
  description:
    "Contractor-first mission control for remodel planning, inspiration, listing photos, and AI design decisions.",
  url: "https://core-remodel.hacolby.workers.dev",
  author: {
    name: "core-remodel",
    url: "https://github.com/jmbish04/core-remodel",
  },
  links: {
    github: "https://github.com/jmbish04/core-remodel",
  },
  navItems: [
    { href: "/admin/budget/tracker", label: "Budget Tracker" },
    { href: "/questionnaire", label: "Questionnaire" },
    { href: "/admin/estimates", label: "Estimates" },
    { href: "/admin/contracts", label: "Contracts" },
    { href: "/admin/prepare/uploads", label: "Uploads" },
    { href: "/supporting-docs", label: "Supporting Docs" },
    { href: "/floor-plan", label: "Floor Plan" },
    { href: "/moodboards", label: "Mood Boards" },
    { href: "/admin/prepare/review", label: "Review" },
    { href: "/photos/listing", label: "Listing Photos" },
    { href: "/photos/inspiration", label: "Inspiration Photos" },
    { href: "/admin/photo-edits", label: "Photo Edits" },
    { href: "/admin/designs/decision-room", label: "Decision Room" },
    { href: "/admin", label: "Admin" },
  ],
};
