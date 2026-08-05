with open('AGENTS.md', 'r') as f:
    text = f.read()

# Add empty line before ## Cloudflare Durable
text = text.replace('## Cloudflare Durable Objects', '\n## Cloudflare Durable Objects')

with open('AGENTS.md', 'w') as f:
    f.write(text)
