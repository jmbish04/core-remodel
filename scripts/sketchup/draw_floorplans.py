import asyncio
import os
import sys
import argparse
import subprocess
import json
import xml.etree.ElementTree as ET
import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from dotenv import load_dotenv

# Load local environment
load_dotenv()

# Setup default paths relative to workspace root
WORKSPACE_ROOT = "/Volumes/Projects/workers/core-remodel"
DEFAULT_LOWER_SVG = os.path.join(WORKSPACE_ROOT, "scripts/sketchup/traced_lower_walls.svg")
DEFAULT_UPPER_SVG = os.path.join(WORKSPACE_ROOT, "scripts/sketchup/traced_upper_walls.svg")
DEFAULT_COORDINATES_JSON = os.path.join(WORKSPACE_ROOT, "proofs/data/floorplan_coordinates.json")

def get_secret(key_name: str, fallback_key: str = None) -> str:
    val = os.getenv(key_name)
    if val:
        return val
    if fallback_key:
        val = os.getenv(fallback_key)
        if val:
            return val
    for k in [key_name, fallback_key]:
        if not k:
            continue
        try:
            result = subprocess.run(
                ["tokens", "show", k, "--value-only"],
                capture_output=True,
                text=True,
                check=True
            )
            ret_val = result.stdout.strip()
            if ret_val:
                return ret_val
        except (subprocess.CalledProcessError, FileNotFoundError):
            pass
    return ""

def parse_svg_lines(svg_path):
    """Parse SVG file and extract all lines as ((x1, y1), (x2, y2)) tuples."""
    if not os.path.exists(svg_path):
        print(f"Error: SVG file not found at {svg_path}")
        return []
    
    tree = ET.parse(svg_path)
    root = tree.getroot()
    ns = {'svg': 'http://www.w3.org/2000/svg'}
    
    lines = []
    # Search with and without namespace
    line_elements = root.findall('.//svg:line', ns) or root.findall('.//line')
    for line in line_elements:
        try:
            x1 = float(line.get('x1'))
            y1 = float(line.get('y1'))
            x2 = float(line.get('x2'))
            y2 = float(line.get('y2'))
            lines.append(((x1, y1), (x2, y2)))
        except (ValueError, TypeError):
            continue
            
    print(f"Parsed {len(lines)} lines from {os.path.basename(svg_path)}")
    return lines

def build_svg_code(lower_lines, upper_lines):
    """Generate SketchUp Python code to draw lines from the parsed SVGs."""
    
    # We normalize both SVGs to the same 25ft x 58ft footprint (300" x 696")
    # This aligns the levels perfectly in 3D space
    width_inches = 25.0 * 12.0  # 300 inches
    depth_inches = 58.0 * 12.0  # 696 inches
    
    code_parts = [
        "# SketchUp Python Script generated to draw floorplan lines",
        "mat_lower = get_or_create_material('Lower_Level_Lines', 50, 100, 240)",
        "mat_upper = get_or_create_material('Upper_Level_Lines', 240, 80, 80)",
        ""
    ]
    
    def process_level(lines, name, z_height, material_var):
        if not lines:
            return []
            
        # Find bounds for normalization
        min_x = min(min(l[0][0], l[1][0]) for l in lines)
        max_x = max(max(l[0][0], l[1][0]) for l in lines)
        min_y = min(min(l[0][1], l[1][1]) for l in lines)
        max_y = max(max(l[0][1], l[1][1]) for l in lines)
        
        w_pixels = max_x - min_x
        h_pixels = max_y - min_y
        
        # Build unique vertices list for GeometryInput
        unique_verts = []
        vert_to_idx = {}
        
        def get_v_idx(x, y):
            # Scale to inches
            su_x = ((x - min_x) / w_pixels) * width_inches if w_pixels > 0 else 0.0
            # Invert Y coordinate so bottom of image is Y=0 (street side)
            su_y = (1.0 - ((y - min_y) / h_pixels)) * depth_inches if h_pixels > 0 else 0.0
            
            key = (round(su_x, 3), round(su_y, 3), round(z_height, 3))
            if key not in vert_to_idx:
                vert_to_idx[key] = len(unique_verts)
                unique_verts.append(f"SUPoint3D({key[0]}, {key[1]}, {key[2]})")
            return vert_to_idx[key]
            
        edges = []
        for p1, p2 in lines:
            v0 = get_v_idx(p1[0], p1[1])
            v1 = get_v_idx(p2[0], p2[1])
            edges.append((v0, v1))
            
        # Emit code to construct the group and entities
        parts = [
            f"# Level: {name} at Z={z_height}",
            f"group = Group()",
            f"model.get_entities().add_group(group)",
            f"group.set_name('{name}_Lines')",
            f"geom = GeometryInput()",
            f"geom.set_vertices([" + ", ".join(unique_verts) + "])"
        ]
        
        for v0, v1 in edges:
            parts.append(f"_, geom = geom.add_edge({v0}, {v1})")
            
        parts.extend([
            f"group.get_entities().fill(geom, weld_vertices=True)",
            f"apply_material(group, {material_var})",
            ""
        ])
        return parts

    # Lower level at Z = 0
    code_parts.extend(process_level(lower_lines, "Lower_Level", 0.0, "mat_lower"))
    # Upper level at Z = 120 (10 feet floor-to-floor height)
    code_parts.extend(process_level(upper_lines, "Upper_Level", 120.0, "mat_upper"))
    
    # Setup standard style and camera
    code_parts.extend([
        "# Configure default model visual styles",
        "ro = model.get_rendering_options()",
        "ro[RenderingOptionKey.DRAW_GROUND] = TypedValue(bool_value=True)",
        "ro[RenderingOptionKey.DRAW_HORIZON] = TypedValue(bool_value=True)",
        ""
    ])
    
    return "\n".join(code_parts)

def build_json_code(json_path):
    """Generate SketchUp Python code to build a clean 3D blueprint from room coordinates."""
    if not os.path.exists(json_path):
        print(f"Error: Coordinates JSON not found at {json_path}")
        return ""
        
    with open(json_path, 'r') as f:
        data = json.load(f)
        
    code_parts = [
        "# SketchUp Python Script generated from clean architectural coordinates",
        "mat_wall = get_or_create_material('3D_Walls', 220, 220, 220)",
        "mat_floor = get_or_create_material('3D_Floors', 140, 140, 150)",
        "mat_glass = get_or_create_material('Glass', 200, 230, 255, 100)", # Transparent
        ""
    ]
    
    # Helper to draw a box using make_quad_box
    code_parts.extend([
        "def draw_box(group, name, x, y, z, w, d, h, material):",
        "    box_group = Group()",
        "    group.get_entities().add_group(box_group)",
        "    box_group.set_name(name)",
        "    geom = GeometryInput()",
        "    geom.set_vertices([",
        "        SUPoint3D(0,0,0), SUPoint3D(w,0,0), SUPoint3D(w,d,0), SUPoint3D(0,d,0),",
        "        SUPoint3D(0,0,h), SUPoint3D(w,0,h), SUPoint3D(w,d,h), SUPoint3D(0,d,h)",
        "    ])",
        "    for fv in [[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7],[4,5,6,7],[0,3,2,1]]:",
        "        loop = LoopInput()",
        "        for i in fv: loop.add_vertex_index(i)",
        "        _, geom = geom.add_face(loop)",
        "    box_group.get_entities().fill(geom, weld_vertices=True)",
        "    apply_material(box_group, material)",
        "    # Apply translation",
        "    t = SUTransformation([1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1])",
        "    box_group.set_transform(t)",
        ""
    ])
    
    # Draw lower level
    code_parts.append("# Draw 3D Lower Level (Z=0)")
    code_parts.append("lower_group = Group()")
    code_parts.append("model.get_entities().add_group(lower_group)")
    code_parts.append("lower_group.set_name('Lower_Level_3D')")
    
    lower_rooms = data.get("lower_level", {})
    for room_id, r in lower_rooms.items():
        coords = r.get("coordinates_feet", {})
        x1, y1, x2, y2 = coords.get("x_min"), coords.get("y_min"), coords.get("x_max"), coords.get("y_max")
        if None in (x1, y1, x2, y2):
            continue
        # Convert to inches
        x, y, w, d = x1*12, y1*12, (x2-x1)*12, (y2-y1)*12
        # Draw floor slab
        code_parts.append(f"draw_box(lower_group, '{r['display_name']}_Floor', {x}, {y}, -6.0, {w}, {d}, 6.0, mat_floor)")
        # Draw 3D Walls (9ft high = 108 inches)
        # Left wall (5 inches thick)
        code_parts.append(f"draw_box(lower_group, '{r['display_name']}_Wall_Left', {x-2.5}, {y}, 0.0, 5.0, {d}, 108.0, mat_wall)")
        # Right wall
        code_parts.append(f"draw_box(lower_group, '{r['display_name']}_Wall_Right', {x+w-2.5}, {y}, 0.0, 5.0, {d}, 108.0, mat_wall)")
        # Bottom wall
        code_parts.append(f"draw_box(lower_group, '{r['display_name']}_Wall_Bottom', {x}, {y-2.5}, 0.0, {w}, 5.0, 108.0, mat_wall)")
        # Top wall
        code_parts.append(f"draw_box(lower_group, '{r['display_name']}_Wall_Top', {x}, {y+d-2.5}, 0.0, {w}, 5.0, 108.0, mat_wall)")
        
    # Draw upper level
    code_parts.append("\n# Draw 3D Upper Level (Z=120)")
    code_parts.append("upper_group = Group()")
    code_parts.append("model.get_entities().add_group(upper_group)")
    code_parts.append("upper_group.set_name('Upper_Level_3D')")
    
    upper_rooms = data.get("upper_level", {})
    for room_id, r in upper_rooms.items():
        coords = r.get("coordinates_feet", {})
        x1, y1, x2, y2 = coords.get("x_min"), coords.get("y_min"), coords.get("x_max"), coords.get("y_max")
        if None in (x1, y1, x2, y2):
            continue
        # Convert to inches
        x, y, w, d = x1*12, y1*12, (x2-x1)*12, (y2-y1)*12
        # Draw floor slab (Z=108 to Z=120)
        code_parts.append(f"draw_box(upper_group, '{r['display_name']}_Floor', {x}, {y}, 108.0, {w}, {d}, 12.0, mat_floor)")
        # Draw 3D Walls (9ft high = 108 inches) from Z=120 to Z=228
        # Left wall
        code_parts.append(f"draw_box(upper_group, '{r['display_name']}_Wall_Left', {x-2.5}, {y}, 120.0, 5.0, {d}, 108.0, mat_wall)")
        # Right wall
        code_parts.append(f"draw_box(upper_group, '{r['display_name']}_Wall_Right', {x+w-2.5}, {y}, 120.0, 5.0, {d}, 108.0, mat_wall)")
        # Bottom wall
        code_parts.append(f"draw_box(upper_group, '{r['display_name']}_Wall_Bottom', {x}, {y-2.5}, 120.0, {w}, 5.0, 108.0, mat_wall)")
        # Top wall
        code_parts.append(f"draw_box(upper_group, '{r['display_name']}_Wall_Top', {x}, {y+d-2.5}, 120.0, {w}, 5.0, 108.0, mat_wall)")
        
    return "\n".join(code_parts)

async def run_sketchup_build(code, filename):
    """Submit generated Python code to Trimble SketchUp MCP server via JSON-RPC POST."""
    trimble_token = get_secret("TRIMBLE_ACCESS_TOKEN", "TRIMBLE_API_KEY")
    if not trimble_token:
        print("Error: Missing TRIMBLE_ACCESS_TOKEN or TRIMBLE_API_KEY.")
        return False

    mcp_url = "https://api.sketchup.com/mcp/v1/sketchup/mcp"
    headers = {
        "Authorization": f"Bearer {trimble_token}",
    }
    
    httpx_client = httpx.AsyncClient(headers=headers, timeout=httpx.Timeout(30.0, read=300.0))

    print(f"Connecting to Trimble SketchUp MCP at {mcp_url}...")
    async with streamable_http_client(url=mcp_url, http_client=httpx_client) as (read_stream, write_stream, _):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            print("Connected to SketchUp successfully. Loading baseline skills...")
            
            # Retrieve available skills and load them
            skills_resp = await session.call_tool("list_skills", arguments={})
            for skill_name in ["sketchup-sdk", "sketchup-clean-geometry"]:
                print(f"Loading skill: {skill_name}")
                await session.call_tool("read_skill", arguments={"name": skill_name})

            print("Submitting drawing script to SketchUp model...")
            build_resp = await session.call_tool(
                "build_model", 
                arguments={"clean": True, "code": code}
            )
            print("Drawing command completed successfully!")
            
            # Save the model
            print(f"Saving model to cloud as '{filename}'...")
            save_resp = await session.call_tool(
                "save_model",
                arguments={"filename": filename, "keep_session": False}
            )
            print("Model saved! Response:")
            print(save_resp)
            
            # Extract download URL and download the file locally
            download_url = None
            try:
                if hasattr(save_resp, "structuredContent") and save_resp.structuredContent:
                    download_url = save_resp.structuredContent.get("download_url")
                elif hasattr(save_resp, "structured_content") and save_resp.structured_content:
                    download_url = save_resp.structured_content.get("download_url")
            except Exception:
                pass
                
            if download_url:
                local_path = os.path.join(WORKSPACE_ROOT, "scripts/sketchup", filename)
                print(f"Downloading '{filename}' locally to {local_path}...")
                try:
                    async with httpx.AsyncClient(follow_redirects=True) as dl_client:
                        # Use the same headers (containing Authorization token) in case it is required
                        dl_resp = await dl_client.get(download_url, headers=headers)
                        if dl_resp.status_code == 200:
                            with open(local_path, "wb") as f:
                                f.write(dl_resp.content)
                            print(f"Successfully downloaded and saved {filename} locally!")
                        else:
                            print(f"Failed to download file: HTTP {dl_resp.status_code}")
                except Exception as e:
                    print(f"Error downloading file: {e}")
            return True

def main():
    parser = argparse.ArgumentParser(description="Draw 3D floorplan blueprints in Trimble SketchUp via MCP.")
    parser.add_argument("--mode", choices=["svg", "json"], default="svg",
                        help="Mode: 'svg' to draw line segments parsed from SVGs, 'json' to build clean 3D boxes from coordinates JSON.")
    parser.add_argument("--lower-svg", default=DEFAULT_LOWER_SVG, help="Path to lower level walls SVG.")
    parser.add_argument("--upper-svg", default=DEFAULT_UPPER_SVG, help="Path to upper level walls SVG.")
    parser.add_argument("--json", default=DEFAULT_COORDINATES_JSON, help="Path to coordinates JSON.")
    
    args = parser.parse_args()
    
    if args.mode == "svg":
        print(f"Starting SVG floorplan line drawer...")
        lower_lines = parse_svg_lines(args.lower_svg)
        upper_lines = parse_svg_lines(args.upper_svg)
        
        if not lower_lines and not upper_lines:
            print("Error: No lines parsed from SVG files. Exiting.")
            sys.exit(1)
            
        code = build_svg_code(lower_lines, upper_lines)
        filename = "floorplan_3d_blueprint_svg.skp"
    else:
        print(f"Starting JSON architectural 3D blueprint builder...")
        code = build_json_code(args.json)
        if not code:
            sys.exit(1)
        filename = "floorplan_3d_blueprint_json.skp"
            
    # Run the build on the SketchUp server
    asyncio.run(run_sketchup_build(code, filename))

if __name__ == "__main__":
    main()
