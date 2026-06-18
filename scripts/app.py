import os
import json
import shutil
import socket
import subprocess
import signal
import time
from datetime import datetime
from flask import Flask, jsonify, request, send_from_directory, render_template_string

app = Flask(__name__)

# Absolute base directory of the ai_renders assets (coordinates, blank_images,
# revisions, templates). This script lives under scripts/ now, but its assets stay
# put in the proofs/.../ai_renders directory, so BASE_DIR points there explicitly.
BASE_DIR = "/Volumes/Projects/workers/core-remodel/proofs/tight/jason_20260615/upper_level/kitchen/ai_renders"
COORDINATES_FILE = os.path.join(BASE_DIR, "ai_photo_coordinates.json")
BLANK_IMAGES_DIR = os.path.join(BASE_DIR, "blank_images")
REVISIONS_DIR = os.path.join(BASE_DIR, "revisions")

# Ensure revisions directory exists
os.makedirs(REVISIONS_DIR, exist_ok=True)

# Helper: load coordinates
def load_coords():
    if not os.path.exists(COORDINATES_FILE):
        return {}
    try:
        with open(COORDINATES_FILE, "r") as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading coordinates: {e}")
        return {}

# Helper: save coordinates and backup
def save_coords_with_backup(data):
    # 1. Create a revision backup of the current file if it exists
    if os.path.exists(COORDINATES_FILE):
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_filename = f"ai_photo_coordinates.backup.{timestamp}.json"
        backup_path = os.path.join(REVISIONS_DIR, backup_filename)
        try:
            shutil.copy2(COORDINATES_FILE, backup_path)
            print(f"Backup created: {backup_filename}")
        except Exception as e:
            print(f"Failed to create backup: {e}")

    # 2. Write the new coordinates to the main file
    try:
        with open(COORDINATES_FILE, "w") as f:
            json.dump(data, f, indent=2)
        return True
    except Exception as e:
        print(f"Failed to save coordinates: {e}")
        return False

# Helper: Kill process holding port
def kill_process_on_port(port):
    """Checks if a port is in use, and if so, terminates the process using it."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        in_use = s.connect_ex(('127.0.0.1', port)) == 0

    if in_use:
        print(f"Port {port} is busy. Attempting to free it...")
        try:
            # lsof -t -i :<port> returns only the PIDs on macOS and Linux
            pids_bytes = subprocess.check_output(["lsof", "-t", f"-i:{port}"])
            pids = pids_bytes.decode().strip().split("\n")
            for pid_str in pids:
                if pid_str:
                    pid = int(pid_str)
                    if pid != os.getpid():
                        print(f"Killing process {pid} holding port {port}...")
                        os.kill(pid, signal.SIGTERM)
            time.sleep(0.5)  # Wait for socket to release
        except Exception as e:
            print(f"Failed to release port {port}: {e}")

# Route: Serve frontend HTML page
@app.route("/")
def index():
    template_path = os.path.join(BASE_DIR, "templates", "index.html")
    if not os.path.exists(template_path):
        return "Frontend template not found. Please verify templates/index.html exists.", 404

    with open(template_path, "r") as f:
        html_content = f.read()
    return render_template_string(html_content)

# Route: Kitchen Layout Visualizer page
@app.route("/layout")
def layout():
    template_path = os.path.join(BASE_DIR, "templates", "layout.html")
    if not os.path.exists(template_path):
        return "Layout template not found. Please verify templates/layout.html exists.", 404

    with open(template_path, "r") as f:
        html_content = f.read()
    return render_template_string(html_content)

# Route: Get list of blank images
@app.route("/api/images")
def get_images():
    if not os.path.exists(BLANK_IMAGES_DIR):
        return jsonify([])
    files = [f for f in os.listdir(BLANK_IMAGES_DIR) if f.lower().endswith(('.jpeg', '.jpg', '.png'))]
    return jsonify(sorted(files))

# Route: Serve blank images
@app.route("/blank_images/<path:filename>")
def serve_blank_image(filename):
    return send_from_directory(BLANK_IMAGES_DIR, filename)

# Route: Get current coordinates
@app.route("/api/coordinates")
def get_coordinates():
    return jsonify(load_coords())

# Route: Save coordinates
@app.route("/api/coordinates", methods=["POST"])
def post_coordinates():
    data = request.json
    if not isinstance(data, dict):
        return jsonify({"success": False, "error": "Invalid request body"}), 400

    if save_coords_with_backup(data):
        return jsonify({"success": True})
    return jsonify({"success": False, "error": "Save failed"}), 500

# Route: List available revisions
@app.route("/api/revisions")
def get_revisions():
    if not os.path.exists(REVISIONS_DIR):
        return jsonify([])
    revisions = []
    for f in os.listdir(REVISIONS_DIR):
        if f.startswith("ai_photo_coordinates.backup.") and f.endswith(".json"):
            parts = f.split(".")
            if len(parts) >= 4:
                ts_str = parts[2]
                try:
                    dt = datetime.strptime(ts_str, "%Y%m%d_%H%M%S")
                    formatted_time = dt.strftime("%b %d, %Y - %I:%M:%S %p")
                except Exception:
                    formatted_time = ts_str
                revisions.append({
                    "filename": f,
                    "timestamp": formatted_time,
                    "raw_time": ts_str
                })
    revisions.sort(key=lambda x: x["raw_time"], reverse=True)
    return jsonify(revisions)

# Route: Restore a specific revision
@app.route("/api/revisions/restore", methods=["POST"])
def restore_revision():
    data = request.json or {}
    filename = data.get("filename")
    if not filename:
        return jsonify({"success": False, "error": "Missing filename"}), 400

    revision_path = os.path.join(REVISIONS_DIR, filename)
    if not os.path.exists(revision_path):
        return jsonify({"success": False, "error": "Revision file not found"}), 404

    if os.path.exists(COORDINATES_FILE):
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        safety_backup = f"ai_photo_coordinates.backup.{ts}.pre_restore.json"
        try:
            shutil.copy2(COORDINATES_FILE, os.path.join(REVISIONS_DIR, safety_backup))
        except Exception as e:
            print(f"Safety backup failed: {e}")

    try:
        shutil.copy2(revision_path, COORDINATES_FILE)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == "__main__":
    PORT = 5001
    # Only release port during initial startup (not inside Werkzeug debug child restarts)
    if os.environ.get("WERKZEUG_RUN_MAIN") != "true":
        kill_process_on_port(PORT)
    # Run on port 5001 to avoid common macOS AirPlay port 5000 conflicts
    app.run(host="127.0.0.1", port=PORT, debug=True, use_reloader=False)
