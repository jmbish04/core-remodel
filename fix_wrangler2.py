with open("wrangler.jsonc", "r") as f:
    text = f.read()

# Replace all Vectorize index configuration with some local dummy ones just so that wrangler dev does not fail due to remote requirements
import re
text = re.sub(r'"vectorize":\s*\[(.*?)\]', '"vectorize": []', text, flags=re.DOTALL)
text = text.replace('"ai": { "binding": "AI" }', '"ai": { "binding": "AI" }') # Leave it as is but remote doesn't work for vectorize without login

with open("wrangler.jsonc", "w") as f:
    f.write(text)
