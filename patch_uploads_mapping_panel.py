import re

with open("src/frontend/components/UploadsMappingPanel.tsx", "r") as f:
    content = f.read()

listing_button = """          <button
            type="button"
            className={cn(
              "rounded-lg border px-3 py-2 text-left transition",
              activeCategory === "listing"
                ? "border-primary bg-primary/10"
                : "border-border/60 hover:bg-muted/30",
            )}
            onClick={() => setActiveCategory("listing")}
          >
            <p className="text-sm font-semibold">Listing Mapping</p>
            <p className="text-xs text-muted-foreground">
              {summary.listing} listing photo(s) pending
            </p>
          </button>"""

inspirational_button = """          <button
            type="button"
            className={cn(
              "rounded-lg border px-3 py-2 text-left transition",
              activeCategory === "inspirational"
                ? "border-primary bg-primary/10"
                : "border-border/60 hover:bg-muted/30",
            )}
            onClick={() => setActiveCategory("inspirational")}
          >
            <p className="text-sm font-semibold">Inspiration Mapping</p>
            <p className="text-xs text-muted-foreground">
              {summary.inspirational} inspiration photo(s) pending
            </p>
          </button>"""

original_buttons = listing_button + "\n" + inspirational_button
new_buttons = inspirational_button + "\n" + listing_button

content = content.replace(original_buttons, new_buttons)

with open("src/frontend/components/UploadsMappingPanel.tsx", "w") as f:
    f.write(content)
