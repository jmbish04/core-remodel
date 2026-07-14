import sys

file_path = "src/frontend/components/PhotoReviewApp.tsx"
with open(file_path, "r") as f:
    content = f.read()

# Make sure they are all in one column under the image by moving Tags and Highlights inside the flex container
start_marker = "{/* Coding fields — stacked below the image */}"
end_marker = """<div className="flex items-center justify-end gap-2 pt-4">"""
content = content.replace(
    '''              {/* Coding fields — stacked below the image */}
              <div className="flex flex-col gap-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="review-title"
                    className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    Title
                  </label>
                  <Input
                    id="review-title"
                    value={panelTitle}
                    onChange={(event) => setPanelTitle(event.target.value)}
                    placeholder="Kitchen sink wall concept"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="review-description"
                    className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    Description
                  </label>
                  <Textarea
                    id="review-description"
                    value={panelDescription}
                    onChange={(event) =>
                      setPanelDescription(event.target.value)
                    }
                    rows={3}
                    placeholder="Lighting, finishes, layout ideas..."
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Tag className="size-3.5" />
                  Tags
                </span>''',
    '''              {/* Coding fields — stacked below the image */}
              <div className="flex flex-col gap-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="review-title"
                    className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    Title
                  </label>
                  <Input
                    id="review-title"
                    value={panelTitle}
                    onChange={(event) => setPanelTitle(event.target.value)}
                    placeholder="Kitchen sink wall concept"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="review-description"
                    className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    Description
                  </label>
                  <Textarea
                    id="review-description"
                    value={panelDescription}
                    onChange={(event) =>
                      setPanelDescription(event.target.value)
                    }
                    rows={3}
                    placeholder="Lighting, finishes, layout ideas..."
                  />
                </div>

                <div className="space-y-1.5">
                  <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <Tag className="size-3.5" />
                    Tags
                  </span>'''
)

content = content.replace(
'''              <div className="space-y-2 rounded-lg border border-border/40 p-3">
                <div className="flex items-center justify-between gap-2">''',
'''                <div className="space-y-2 rounded-lg border border-border/40 p-3">
                  <div className="flex items-center justify-between gap-2">'''
)


with open(file_path, "w") as f:
    f.write(content)

print("Fixed!")
