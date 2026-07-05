"""Tkinter-based GUI for drawing polygon masks on camera-angle photos."""
import json
import tkinter as tk
from tkinter import messagebox
from pathlib import Path
from PIL import Image, ImageTk

from ai_photo_pipeline.providers.gemini import segment_image

from ..core.constants import (
    OUTPUT_JSON,
    OBJECTS,
    MAX_CANVAS_W,
    MAX_CANVAS_H,
    FLOORPLAN_SIDEBAR_W,
    POINT_RADIUS,
    LINE_WIDTH,
)
from ..core.masks import get_normalized_point


class MaskDrawingApp:
    """Interactive polygon-mask drawing tool for camera-angle blank-canvas images."""

    def __init__(self, root: tk.Tk, image_paths: list[Path], floorplan_path: Path):
        self.root = root
        self.image_paths = image_paths
        self.floorplan_path = floorplan_path
        self.current_index = 0
        self.active_object: str | None = None

        # Per-image data: {img_name: {obj_key: [normalised points] | "not_visible"}}
        self.mask_data: dict[str, dict] = {p.name: {} for p in image_paths}

        # Load existing data if present
        if OUTPUT_JSON.exists():
            try:
                with open(OUTPUT_JSON) as f:
                    saved = json.load(f)
                for name in self.mask_data:
                    if name in saved:
                        self.mask_data[name] = saved[name]
            except (json.JSONDecodeError, KeyError):
                pass

        # In-progress polygon drawing state
        self._drawing_points: list[tuple[float, float]] = []
        self._point_ids: list[int] = []
        self._line_ids: list[int] = []
        self._awaiting_double = False  # prevents double-click ghost point

        # Image scale/offset (set per image load)
        self._scale = 1.0
        self._off_x = 0
        self._off_y = 0
        self._img_w = 1
        self._img_h = 1

        # Tk keeps PhotoImage refs alive via this dict
        self._photos: dict[str, ImageTk.PhotoImage] = {}

        self._build_ui()
        # Defer first image load until the window has been measured
        self.root.after(50, lambda: self._load_image(0))

    def _build_ui(self):
        self.root.title("Mask Drawing — Camera Angles")
        self.root.configure(bg="#1a1a2e")

        # ▸ Top: progress
        top = tk.Frame(self.root, bg="#16213e", pady=8, padx=14)
        top.pack(fill=tk.X)
        self._lbl_progress = tk.Label(
            top, text="", font=("Helvetica", 14, "bold"), fg="#e0e0e0", bg="#16213e",
        )
        self._lbl_progress.pack(side=tk.LEFT)
        self._lbl_file = tk.Label(top, text="", font=("Helvetica", 11), fg="#777", bg="#16213e")
        self._lbl_file.pack(side=tk.LEFT, padx=(16, 0))

        # ▸ Palette row
        pal = tk.Frame(self.root, bg="#0f3460", pady=6, padx=14)
        pal.pack(fill=tk.X)
        tk.Label(pal, text="OBJECT:", font=("Helvetica", 10, "bold"), fg="#999", bg="#0f3460").pack(
            side=tk.LEFT, padx=(0, 6),
        )

        self._obj_btns: dict[str, tk.Button] = {}
        for key, label, color in OBJECTS:
            btn = tk.Button(
                pal, text=label, font=("Helvetica", 10),
                bg="#2a2a4a", fg=color, activebackground=color,
                activeforeground="#000", relief=tk.FLAT, padx=10, pady=4,
                command=lambda k=key: self._select_object(k),
            )
            btn.pack(side=tk.LEFT, padx=3)
            self._obj_btns[key] = btn

        tk.Frame(pal, bg="#0f3460", width=16).pack(side=tk.LEFT)

        self._var_not_vis = tk.BooleanVar()
        self._cb_not_vis = tk.Checkbutton(
            pal, text="Not visible from this angle", variable=self._var_not_vis,
            font=("Helvetica", 10), fg="#ff6b6b", bg="#0f3460", selectcolor="#1a1a2e",
            activebackground="#0f3460", command=self._toggle_not_visible,
        )
        self._cb_not_vis.pack(side=tk.LEFT, padx=(0, 12))

        for txt, cmd in [
            ("Undo", self._undo_point),
            ("Clear", self._clear_current_object),
            ("AI Suggest", self._ai_suggest),
        ]:
            fg = "#4ECDC4" if txt == "AI Suggest" else "#ccc"
            tk.Button(
                pal, text=txt, font=("Helvetica", 9), bg="#2a2a4a", fg=fg,
                relief=tk.FLAT, padx=8, command=cmd,
            ).pack(side=tk.RIGHT, padx=2)

        # ▸ Main content: floorplan sidebar + canvas
        body = tk.Frame(self.root, bg="#1a1a2e")
        body.pack(fill=tk.BOTH, expand=True)

        # Floorplan sidebar
        sidebar = tk.Frame(body, bg="#16213e", width=FLOORPLAN_SIDEBAR_W)
        sidebar.pack(side=tk.LEFT, fill=tk.Y, padx=(8, 0), pady=8)
        sidebar.pack_propagate(False)
        tk.Label(sidebar, text="FLOORPLAN", font=("Helvetica", 9, "bold"), fg="#888", bg="#16213e").pack(
            pady=(8, 4),
        )
        self._lbl_floor = tk.Label(sidebar, bg="#16213e")
        self._lbl_floor.pack(fill=tk.BOTH, expand=True, padx=4, pady=4)
        self._load_floorplan()

        # Legend
        legend = tk.Frame(sidebar, bg="#16213e")
        legend.pack(fill=tk.X, padx=8, pady=(4, 8))
        for key, label, color in OBJECTS:
            row = tk.Frame(legend, bg="#16213e")
            row.pack(fill=tk.X, pady=1)
            tk.Canvas(row, width=12, height=12, bg=color, highlightthickness=0).pack(side=tk.LEFT, padx=(0, 6))
            tk.Label(row, text=label, font=("Helvetica", 8), fg="#ccc", bg="#16213e").pack(side=tk.LEFT)

        # Canvas
        canvas_frame = tk.Frame(body, bg="#1a1a2e")
        canvas_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=8, pady=8)
        self.canvas = tk.Canvas(
            canvas_frame, bg="#111", highlightthickness=1,
            highlightbackground="#333", cursor="crosshair",
        )
        self.canvas.pack(fill=tk.BOTH, expand=True)
        self.canvas.bind("<Button-1>", self._on_click)
        self.canvas.bind("<Double-Button-1>", self._on_double_click)
        self.canvas.bind("<Motion>", self._on_motion)
        self.canvas.bind("<Configure>", self._on_canvas_resize)

        # ▸ Bottom nav
        nav = tk.Frame(self.root, bg="#16213e", pady=8, padx=14)
        nav.pack(fill=tk.X)
        self._btn_prev = tk.Button(
            nav, text="← Previous", font=("Helvetica", 11), bg="#2a2a4a", fg="#ccc",
            relief=tk.FLAT, padx=16, pady=4, command=self._prev_image, state=tk.DISABLED,
        )
        self._btn_prev.pack(side=tk.LEFT)
        self._lbl_status = tk.Label(
            nav, text="Select an object, then click to draw polygon vertices",
            font=("Helvetica", 10), fg="#888", bg="#16213e",
        )
        self._lbl_status.pack(side=tk.LEFT, expand=True)
        self._btn_save = tk.Button(
            nav, text="Save & Exit", font=("Helvetica", 11, "bold"), bg="#4ECDC4", fg="#000",
            relief=tk.FLAT, padx=16, pady=4, command=self._save_and_exit,
        )
        self._btn_save.pack(side=tk.RIGHT, padx=(8, 0))
        self._btn_next = tk.Button(
            nav, text="Next →", font=("Helvetica", 11), bg="#2a2a4a", fg="#ccc",
            relief=tk.FLAT, padx=16, pady=4, command=self._next_image,
        )
        self._btn_next.pack(side=tk.RIGHT)

    def _load_floorplan(self):
        if not self.floorplan_path.exists():
            return
        img = Image.open(self.floorplan_path)
        ratio = min((FLOORPLAN_SIDEBAR_W - 16) / img.width, 600 / img.height)
        img = img.resize((int(img.width * ratio), int(img.height * ratio)), Image.Resampling.LANCZOS)
        photo = ImageTk.PhotoImage(img)
        self._lbl_floor.configure(image=photo)
        self._photos["floorplan"] = photo

    def _load_image(self, index: int):
        self.current_index = index
        path = self.image_paths[index]
        img = Image.open(path)
        self._img_w, self._img_h = img.size

        self.root.update_idletasks()
        cw = max(self.canvas.winfo_width(), 400)
        ch = max(self.canvas.winfo_height(), 300)
        self._scale = min(cw / self._img_w, ch / self._img_h, 1.0)
        dw = int(self._img_w * self._scale)
        dh = int(self._img_h * self._scale)
        self._off_x = (cw - dw) // 2
        self._off_y = (ch - dh) // 2

        img_resized = img.resize((dw, dh), Image.Resampling.LANCZOS)
        photo = ImageTk.PhotoImage(img_resized)
        self.canvas.delete("all")
        self.canvas.create_image(self._off_x, self._off_y, anchor=tk.NW, image=photo, tags="bg")
        self._photos["canvas"] = photo

        # UI chrome
        self._lbl_progress.configure(text=f"Image {index + 1} of {len(self.image_paths)}")
        self._lbl_file.configure(text=path.name)
        self._btn_prev.configure(state=tk.NORMAL if index > 0 else tk.DISABLED)
        self._btn_next.configure(
            state=tk.NORMAL if index < len(self.image_paths) - 1 else tk.DISABLED,
        )

        # Reset drawing state
        self._drawing_points.clear()
        self._point_ids.clear()
        self._line_ids.clear()

        # Redraw saved masks
        self._redraw_all_masks()

        # Refresh object selection highlight + not-visible checkbox
        if self.active_object:
            self._sync_object_ui(self.active_object)

    def _on_canvas_resize(self, _event):
        """Re-render on window resize so masks stay aligned."""
        if self.image_paths:
            self._load_image(self.current_index)

    def _redraw_all_masks(self):
        """Paint every saved polygon for the current image."""
        img_name = self.image_paths[self.current_index].name
        for key, label, color in OBJECTS:
            data = self.mask_data[img_name].get(key)
            if data == "not_visible" or not isinstance(data, list) or len(data) < 3:
                continue
            canvas_pts = [
                (pt["x"] * self._img_w * self._scale + self._off_x,
                 pt["y"] * self._img_h * self._scale + self._off_y)
                for pt in data
            ]
            flat = [c for pt in canvas_pts for c in pt]
            self.canvas.create_polygon(
                flat, fill=color, stipple="gray25", outline=color,
                width=LINE_WIDTH, tags=f"mask_{key}",
            )
            cx = sum(p[0] for p in canvas_pts) / len(canvas_pts)
            cy = sum(p[1] for p in canvas_pts) / len(canvas_pts)
            self.canvas.create_text(cx, cy, text=label, fill="white",
                                    font=("Helvetica", 9, "bold"), tags=f"mask_{key}")

    def _select_object(self, key: str):
        # Finalise any in-progress polygon first
        if self._drawing_points and self.active_object:
            self._finalize_polygon()
        self.active_object = key
        self._drawing_points.clear()
        self._point_ids.clear()
        self._line_ids.clear()
        self._sync_object_ui(key)
        label = next(l for k, l, _ in OBJECTS if k == key)
        self._lbl_status.configure(text=f"Drawing: {label} — click to place vertices, double-click to close")

    def _sync_object_ui(self, key: str):
        """Highlight the active button and sync the not-visible checkbox."""
        for k, btn in self._obj_btns.items():
            color = next(c for ok, _, c in OBJECTS if ok == k)
            if k == key:
                btn.configure(bg=color, fg="#000", relief=tk.SUNKEN)
            else:
                btn.configure(bg="#2a2a4a", fg=color, relief=tk.FLAT)
        img_name = self.image_paths[self.current_index].name
        self._var_not_vis.set(self.mask_data[img_name].get(key) == "not_visible")

    def _on_click(self, event: tk.Event):
        if self._awaiting_double:
            return  # swallow the click half of a double-click
        if not self.active_object:
            self._lbl_status.configure(text="⚠  Select an object first!")
            return
        if self._var_not_vis.get():
            return

        color = next(c for k, _, c in OBJECTS if k == self.active_object)
        r = POINT_RADIUS
        pid = self.canvas.create_oval(
            event.x - r, event.y - r, event.x + r, event.y + r,
            fill=color, outline="white", width=1, tags="draw",
        )
        self._point_ids.append(pid)

        if self._drawing_points:
            px, py = self._drawing_points[-1]
            lid = self.canvas.create_line(
                px, py, event.x, event.y,
                fill=color, width=LINE_WIDTH, dash=(4, 2), tags="draw",
            )
            self._line_ids.append(lid)

        self._drawing_points.append((event.x, event.y))
        self._lbl_status.configure(text=f"{len(self._drawing_points)} pts — double-click to close")

    def _on_double_click(self, event: tk.Event):
        if not self.active_object:
            return
        # The <Button-1> fires BEFORE <Double-Button-1>, adding an extra point.
        # Remove that ghost point before closing the polygon.
        if len(self._drawing_points) > 3:
            self._drawing_points.pop()
            if self._point_ids:
                self.canvas.delete(self._point_ids.pop())
            if self._line_ids:
                self.canvas.delete(self._line_ids.pop())
        if len(self._drawing_points) >= 3:
            self._finalize_polygon()
        # Suppress the next single-click that Tk may queue after Double
        self._awaiting_double = True
        self.root.after(200, self._reset_double_flag)

    def _reset_double_flag(self):
        self._awaiting_double = False

    def _on_motion(self, event: tk.Event):
        self.canvas.delete("rubber")
        if self._drawing_points and self.active_object and not self._var_not_vis.get():
            color = next(c for k, _, c in OBJECTS if k == self.active_object)
            px, py = self._drawing_points[-1]
            self.canvas.create_line(
                px, py, event.x, event.y,
                fill=color, width=1, dash=(2, 4), tags="rubber",
            )

    def _finalize_polygon(self):
        if len(self._drawing_points) < 3:
            return
        key = self.active_object
        color = next(c for k, _, c in OBJECTS if k == key)
        label = next(l for k, l, _ in OBJECTS if k == key)
        img_name = self.image_paths[self.current_index].name

        self.canvas.delete("draw")
        self.canvas.delete("rubber")

        flat = [c for pt in self._drawing_points for c in pt]
        self.canvas.create_polygon(
            flat, fill=color, stipple="gray25", outline=color,
            width=LINE_WIDTH, tags=f"mask_{key}",
        )
        cx = sum(p[0] for p in self._drawing_points) / len(self._drawing_points)
        cy = sum(p[1] for p in self._drawing_points) / len(self._drawing_points)
        self.canvas.create_text(cx, cy, text=label, fill="white",
                                font=("Helvetica", 9, "bold"), tags=f"mask_{key}")

        normalised = [
            get_normalized_point(x, y, self._off_x, self._off_y, self._scale, self._img_w, self._img_h)
            for x, y in self._drawing_points
        ]
        self.mask_data[img_name][key] = normalised

        self._drawing_points.clear()
        self._point_ids.clear()
        self._line_ids.clear()
        self._lbl_status.configure(text=f"✓ {label} saved — pick another object or advance")

    def _toggle_not_visible(self):
        if not self.active_object:
            return
        img_name = self.image_paths[self.current_index].name
        key = self.active_object
        if self._var_not_vis.get():
            self.canvas.delete(f"mask_{key}")
            self.canvas.delete("draw")
            self.canvas.delete("rubber")
            self._drawing_points.clear()
            self._point_ids.clear()
            self._line_ids.clear()
            self.mask_data[img_name][key] = "not_visible"
            label = next(l for k, l, _ in OBJECTS if k == key)
            self._lbl_status.configure(text=f"✓ {label} — not visible from this angle")
        else:
            if self.mask_data[img_name].get(key) == "not_visible":
                del self.mask_data[img_name][key]

    def _undo_point(self):
        if not self._drawing_points:
            return
        self._drawing_points.pop()
        if self._point_ids:
            self.canvas.delete(self._point_ids.pop())
        if self._line_ids:
            self.canvas.delete(self._line_ids.pop())
        self._lbl_status.configure(text=f"{len(self._drawing_points)} pts remaining")

    def _clear_current_object(self):
        if not self.active_object:
            return
        key = self.active_object
        img_name = self.image_paths[self.current_index].name
        self.canvas.delete(f"mask_{key}")
        self.canvas.delete("draw")
        self.canvas.delete("rubber")
        self._drawing_points.clear()
        self._point_ids.clear()
        self._line_ids.clear()
        self._var_not_vis.set(False)
        self.mask_data[img_name].pop(key, None)
        label = next(l for k, l, _ in OBJECTS if k == key)
        self._lbl_status.configure(text=f"Cleared {label} — ready to redraw")

    def _ai_suggest(self):
        """Ask Gemini for a suggested placement box for the active object."""
        if not self.active_object:
            self._lbl_status.configure(text="⚠  Select an object first!")
            return
        label = next(l for k, l, _ in OBJECTS if k == self.active_object)
        self._lbl_status.configure(text=f"🤖 Asking Gemini to suggest placement for {label}…")
        self.root.update()
        try:
            result = segment_image(self.image_paths[self.current_index], label)
            if result and result.get("masks"):
                box = result["masks"][0].get("box_2d")
                if box and len(box) == 4:
                    x, y, w, h = [float(v) for v in box]
                    norm_pts = [
                        {"x": round(x, 4),     "y": round(y, 4)},
                        {"x": round(x + w, 4), "y": round(y, 4)},
                        {"x": round(x + w, 4), "y": round(y + h, 4)},
                        {"x": round(x, 4),     "y": round(y + h, 4)},
                    ]
                    img_name = self.image_paths[self.current_index].name
                    self.mask_data[img_name][self.active_object] = norm_pts
                    self._load_image(self.current_index)
                    self._lbl_status.configure(text=f"✓ AI suggested {label} — adjust or accept")
                    return
            self._lbl_status.configure(text=f"AI could not identify placement for {label}")
        except Exception as exc:
            self._lbl_status.configure(text=f"AI suggestion failed: {exc}")

    def _prev_image(self):
        if self._drawing_points and self.active_object:
            self._finalize_polygon()
        if self.current_index > 0:
            self._load_image(self.current_index - 1)

    def _next_image(self):
        if self._drawing_points and self.active_object:
            self._finalize_polygon()
        if self.current_index < len(self.image_paths) - 1:
            self._load_image(self.current_index + 1)

    def _save_and_exit(self):
        if self._drawing_points and self.active_object:
            self._finalize_polygon()

        empty = [n for n, d in self.mask_data.items() if not d]
        if empty:
            ok = messagebox.askyesno(
                "Incomplete Masks",
                "These images have no masks:\n\n"
                + "\n".join(f"  • {n}" for n in empty)
                + "\n\nSave anyway?",
            )
            if not ok:
                return

        with open(OUTPUT_JSON, "w") as f:
            json.dump(self.mask_data, f, indent=2)
        print(f"\n✓ Mask data saved → {OUTPUT_JSON}")
        self.root.destroy()
