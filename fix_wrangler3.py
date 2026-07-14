with open("wrangler.jsonc", "r") as f:
    text = f.read()

# Replace all Vectorize index configuration with some local dummy ones just so that wrangler dev does not fail due to remote requirements
import re
text = text.replace('"ai": { "binding": "AI" }', '') # Remote doesn't work for ai without login

with open("wrangler.jsonc", "w") as f:
    f.write(text)
