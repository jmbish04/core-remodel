import sys

file_path = "src/frontend/components/PhotoReviewApp.tsx"
with open(file_path, "r") as f:
    content = f.read()

# Make sure to close the flex-col div at the end of the form instead of early
content = content.replace(
'''                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-4">''',
'''                      </div>
                    ))}
                  </div>
                )}
              </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4">'''
)

with open(file_path, "w") as f:
    f.write(content)

print("Fixed!")
