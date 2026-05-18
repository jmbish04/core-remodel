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
    { href: "/budget-tracker", label: "Budget Tracker" },
    { href: "/estimates", label: "Estimates" },
    { href: "/contracts", label: "Contracts" },
    { href: "/uploads", label: "Uploads" },
    { href: "/supporting-docs", label: "Supporting Docs" },
    { href: "/floor-plan", label: "Floor Plan" },
    { href: "/moodboards", label: "Mood Boards" },
    { href: "/review", label: "Review" },
    { href: "/listing-photos", label: "Listing Photos" },
    { href: "/inspiration-photos", label: "Inspiration Photos" },
    { href: "/planning", label: "Planning" },
    { href: "/daily-log", label: "Daily Log" },
    { href: "/weekly-log", label: "Weekly Log" },
    { href: "/photo-edits", label: "Photo Edits" },
    { href: "/decision-room", label: "Decision Room" },
    { href: "/admin", label: "Admin" },
  ],
};
