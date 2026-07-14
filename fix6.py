import sys

file_path = "src/frontend/components/PhotoReviewApp.tsx"
with open(file_path, "r") as f:
    content = f.read()

# Fix the unbalanced tags
content = content.replace(
'''              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="review-title"
                    className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >''',
'''              <div className="flex flex-col gap-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="review-title"
                    className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >'''
)

with open(file_path, "w") as f:
    f.write(content)

print("Fixed!")
