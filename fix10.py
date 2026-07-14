import sys
import re

file_path = "src/frontend/components/PhotoReviewApp.tsx"
with open(file_path, "r") as f:
    content = f.read()

# Make the form stacked instead of grid
content = content.replace(
'''              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label
                    htmlFor="review-title"''',
'''              <div className="flex flex-col gap-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="review-title"'''
)

# And fix SelectValue
select_val_new = """<SelectValue getLabel={(val) => val === "like" ? "I like this" : val === "dislike" ? "I do not like this" : undefined} />"""
content = content.replace(
    "<SelectTrigger className=\"h-8 w-[9rem] text-xs\">\n                      <SelectValue />\n                    </SelectTrigger>",
    f"<SelectTrigger className=\"h-8 w-[9rem] text-xs\">\n                      {select_val_new}\n                    </SelectTrigger>"
)

with open(file_path, "w") as f:
    f.write(content)

print("Fixed!")
