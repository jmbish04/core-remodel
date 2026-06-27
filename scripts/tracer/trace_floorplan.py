import cv2
import numpy as np
import svgwrite
import os  # Added to verify paths directly

# ==========================================
# FILE PATH DEFINITIONS
# ==========================================

lower_path = '/Volumes/Projects/workers/core-remodel/proofs/tight/lower_level_floorplan_for_trace.jpeg'
upper_path = '/Volumes/Projects/workers/core-remodel/proofs/tight/upper_level_floorplan_for_trace.jpeg'

# ==========================================
# SANITY CHECK: VERIFY FILES ACTUALLY EXIST
# ==========================================
if not os.path.exists(upper_path):
    print(f"❌ ERROR: Cannot find upper level file at: {upper_path}")
    print("Please double-check the spelling, folder names, or file extension.")
    exit(1)

if not os.path.exists(lower_path):
    print(f"❌ ERROR: Cannot find lower level file at: {lower_path}")
    print("Please double-check the spelling, folder names, or file extension.")
    exit(1)

# ==========================================
# 1. LOAD IMAGES AND CONVERT TO GRAYSCALE
# ==========================================
img = cv2.imread(upper_path)
l_img = cv2.imread(lower_path)

# Safe check to ensure OpenCV successfully read the image buffers
if img is None or l_img is None:
    print("❌ ERROR: OpenCV failed to decode the images. The files might be corrupted.")
    exit(1)

gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
l_gray = cv2.cvtColor(l_img, cv2.COLOR_BGR2GRAY)

# ==========================================
# 2. INVERT COLORS (Black walls become white)
# ==========================================
# FIXED: Re-added the [1] index slice to extract the thresholded frame array properly
thresh = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY_INV)[1]
l_thresh = cv2.threshold(l_gray, 127, 255, cv2.THRESH_BINARY_INV)[1]

# ==========================================
# 3. DETECT STRUCTURAL WALL COORDINATES
# ==========================================
lines = cv2.HoughLinesP(thresh, rho=1, theta=np.pi/180, threshold=50, minLineLength=40, maxLineGap=10)
l_lines = cv2.HoughLinesP(l_thresh, rho=1, theta=np.pi/180, threshold=50, minLineLength=40, maxLineGap=10)

# ==========================================
# 4. INITIALIZE BLANK SVG CANVASES
# ==========================================
height, width = img.shape[:2]
l_height, l_width = l_img.shape[:2]

dwg = svgwrite.Drawing('traced_walls.svg', size=(width, height))
l_dwg = svgwrite.Drawing('traced_lower_walls.svg', size=(l_width, l_height))

# ==========================================
# 5. EXTRACT & WRITE UPPER LEVEL WALL SEGMENTS
# ==========================================
if lines is not None:
    for idx, line in enumerate(lines):
        x1, y1, x2, y2 = line[0] # Restored index targeting to unpack nested numpy layer
        
        dwg.add(dwg.line(
            start=(int(x1), int(y1)), 
            end=(int(x2), int(y2)), 
            stroke='black', 
            stroke_width=3,
            id=f"upper_wall_segment_{idx}"
        ))
    dwg.save()
    print(f"🏁 Success! Extracted {len(lines)} UPPER level wall segments into traced_walls.svg")
else:
    print("⚠️ Warning: No lines detected in the upper level floor plan.")

# ==========================================
# 6. EXTRACT & WRITE LOWER LEVEL WALL SEGMENTS
# ==========================================
if l_lines is not None:
    for idx, line in enumerate(l_lines):
        x1, y1, x2, y2 = line[0]
        
        l_dwg.add(l_dwg.line(
            start=(int(x1), int(y1)), 
            end=(int(x2), int(y2)), 
            stroke='black', 
            stroke_width=3,
            id=f"lower_wall_segment_{idx}"
        ))
    l_dwg.save()
    print(f"🏁 Success! Extracted {len(l_lines)} LOWER level wall segments into traced_lower_walls.svg")
else:
    print("⚠️ Warning: No lines detected in the lower level floor plan.")
