import { HomeIcon, ImageIcon, LayoutGridIcon, CameraIcon } from "lucide-react";

export function Navigation() {
  const navItems = [
    { href: "/", label: "Home", icon: HomeIcon },
    { href: "/gallery", label: "Gallery", icon: ImageIcon },
    { href: "/moodboards", label: "Mood Boards", icon: LayoutGridIcon },
    { href: "/listing-photos", label: "Listing Photos", icon: CameraIcon },
  ];

  const apiLinks = [
    { href: "/openapi.json", label: "OpenAPI Spec" },
    { href: "/scalar", label: "Scalar" },
    { href: "/swagger", label: "Swagger" },
  ];

  return (
    <nav className="border-b bg-background">
      <div className="container mx-auto flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <a href="/" className="text-xl font-bold text-primary">
            126 Colby - Remodel Mission Control
          </a>
          <div className="flex items-center gap-4">
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="flex items-center gap-2 text-sm font-medium text-foreground/80 transition-colors hover:text-foreground"
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </a>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {apiLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </nav>
  );
}
