import sys

file_path = "src/frontend/components/PhotoReviewApp.tsx"
with open(file_path, "r") as f:
    content = f.read()

# Fix the MultipleSelector section by getting rid of the unbalanced div that was messing things up
content = content.replace(
'''              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label''',
'''              <div className="flex flex-col gap-4">
                <div className="space-y-1.5">
                  <label'''
)
content = content.replace(
'''                    placeholder="Lighting, finishes, layout ideas..."
                  />
                </div>
              </div>

              <div className="space-y-1.5">''',
'''                    placeholder="Lighting, finishes, layout ideas..."
                  />
                </div>

                <div className="space-y-1.5">'''
)

with open(file_path, "w") as f:
    f.write(content)

print("Fixed!")
