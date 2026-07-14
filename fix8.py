import sys
import re

file_path = "src/frontend/components/PhotoReviewApp.tsx"
with open(file_path, "r") as f:
    content = f.read()

# Fix the MultipleSelector section by getting rid of the unbalanced div that was messing things up
content = content.replace(
'''              <div className="flex flex-col gap-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="review-title"
                    className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >''',
'''              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="review-title"
                      className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                    >'''
)
content = content.replace(
'''                    placeholder="Lighting, finishes, layout ideas..."
                  />
                </div>

                <div className="space-y-1.5">
                  <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">''',
'''                    placeholder="Lighting, finishes, layout ideas..."
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">'''
)
content = content.replace(
'''                  searchPlaceholder="Search tags..."
                />
              </div>

                <div className="space-y-2 rounded-lg border border-border/40 p-3">
                  <div className="flex items-center justify-between gap-2">''',
'''                  searchPlaceholder="Search tags..."
                />
              </div>

              <div className="space-y-2 rounded-lg border border-border/40 p-3">
                <div className="flex items-center justify-between gap-2">'''
)


with open(file_path, "w") as f:
    f.write(content)

print("Fixed!")
