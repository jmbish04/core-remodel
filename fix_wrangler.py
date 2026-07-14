with open("wrangler.jsonc", "r") as f:
    text = f.read()
text = text.replace('"remote": true,', '')
text = text.replace('"remote": true', '')
with open("wrangler.jsonc", "w") as f:
    f.write(text)
