with open("src/frontend/components/UniversalUploadApp.tsx", "r") as f:
    content = f.read()

# Fix unused error variable
content = content.replace("} catch (_e) {", "} catch {")

with open("src/frontend/components/UniversalUploadApp.tsx", "w") as f:
    f.write(content)
