import urllib.request
import time
import sys
import json
from urllib.error import HTTPError

max_retries = 30
retry_delay = 1
url = "http://localhost:4321/"

for i in range(max_retries):
    try:
        urllib.request.urlopen(url)
        print("App is ready!")
        sys.exit(0)
    except HTTPError as e:
        if e.code == 500: # Could be an issue connecting to the db or missing wrangler envs
           print("App is up and returned a 500 status.")
           sys.exit(0)
        print(f"Waiting for app... ({i+1}/{max_retries}) HTTP Error {e.code}")
    except Exception as e:
        print(f"Waiting for app... ({i+1}/{max_retries})")
        time.sleep(retry_delay)

print("App failed to start in time.")
sys.exit(1)
