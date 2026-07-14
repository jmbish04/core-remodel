import sys
import re

file_path = "src/frontend/components/PhotoReviewApp.tsx"
with open(file_path, "r") as f:
    content = f.read()

# First get back to working state with 2 columns
# Reverting all the changes...
content = content.replace(
'''              <div className="flex flex-col gap-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="review-title"
                    className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >''',
'''              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label
                    htmlFor="review-title"
                    className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >'''
)

with open(file_path, "w") as f:
    f.write(content)

print("Fixed!")
