with open("src/frontend/components/UniversalUploadApp.tsx", "r") as f:
    content = f.read()

old_panel = """      <UploadsMappingPanel
        refreshToken={mappingRefreshToken}
        onSummaryChange={(nextSummary) => setMappingSummary(nextSummary)}
      />"""

new_panel = """      <UploadsMappingPanel
        refreshToken={mappingRefreshToken}
        onSummaryChange={(nextSummary) => setMappingSummary(nextSummary)}
        category={target}
        onCategoryChange={setTarget}
      />"""

content = content.replace(old_panel, new_panel)

with open("src/frontend/components/UniversalUploadApp.tsx", "w") as f:
    f.write(content)
