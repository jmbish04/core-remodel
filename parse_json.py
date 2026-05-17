import json
import os

with open("appsscript/budget/appsscript_src.json", "r") as f:
    data = json.load(f)

os.makedirs("src/appsscript/src", exist_ok=True)

for file in data.get("files", []):
    name = file.get("name")
    type_ = file.get("type")
    source = file.get("source")

    ext = ".js" if type_ == "server_js" else ".html" if type_ == "html" else ".json"
    filename = f"src/appsscript/src/{name}{ext}"

    with open(filename, "w") as out:
        out.write(source)

print("Files extracted.")
