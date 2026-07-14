import sys

file_path = "src/frontend/components/PhotoReviewApp.tsx"
with open(file_path, "r") as f:
    content = f.read()

# Fix the unbalanced tags
content = content.replace(
'''                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (''',
'''                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-4">
              <Button
                variant="outline"
                onClick={openCrop}
                disabled={isSaving}
              >
                <Crop className="size-4 mr-2" />
                Crop
              </Button>
              <Button
                onClick={saveSelected}
                disabled={isSaving}
              >
                {isSaving ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <Check className="mr-1.5 size-4" />
                )}
                Save & advance
              </Button>
            </div>
          </>
        ) : ('''
)

# And remove the duplicate button block that was pushed down
content = content.replace(
'''              <div className="flex items-center justify-end gap-2 pt-4">
                <Button
                  variant="outline"
                  onClick={openCrop}
                  disabled={isSaving}
                >
                  <Crop className="size-4 sm:mr-2" />
                  <span className="hidden sm:inline">Crop</span>
                </Button>
                <Button onClick={saveSelected} disabled={isSaving}>
                  {isSaving ? (
                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                  ) : (
                    <Check className="mr-1.5 size-4" />
                  )}
                  Save & advance
                </Button>
              </div>
            </div>
          </>''',
'''          </>'''
)

with open(file_path, "w") as f:
    f.write(content)

print("Fixed!")
