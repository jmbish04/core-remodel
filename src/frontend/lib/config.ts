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
  name: "Remodel Mood Board",
  description: "AI-powered image management and mood board creation for your home renovation projects",
  url: "https://core-remodel.hacolby.workers.dev",
  author: {
    name: "core-remodel",
    url: "https://github.com/jmbish04/core-remodel",
  },
  links: {
    github: "https://github.com/jmbish04/core-remodel",
  },
  navItems: [
    { href: "/gallery", label: "Gallery" },
    { href: "/moodboards", label: "Mood Boards" },
    { href: "/review", label: "Review" },
    { href: "/listing-photos", label: "Listing Photos" },
  ],
};
