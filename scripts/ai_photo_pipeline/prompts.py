"""Prompt kit (ported from src/backend/services/render/prompt-kit.ts).

Holds the preservation/anti-hallucination guardrails, the reference-scoping helper
(material/form only), an optional safety policy, and the structured stage-prompt builder.
"""

# Structure-preservation guardrails — the #1 anti-hallucination lever. The closing
# catch-all line is adopted from the google-ai-studio image-editing template and covers
# anything the enumerated rules do not name explicitly.
PRESERVATION_BLOCK = "\n".join([
    "- PRESERVE EXACTLY (do not change in any way): the flooring (its material, color, "
    "finish, and plank direction), every wall and wall color, all windows and their grids, "
    "all openings, the ceiling, the room's dimensions and proportions, and the camera angle.",
    "- Do NOT invent, move, widen, or close any wall, window, or opening.",
    "- Do NOT crop, zoom, pan, rotate, re-frame, or change the aspect ratio — the output "
    "framing must match the input one-to-one.",
    "- Do NOT add any furniture, rugs, decor, plants, or props that are not explicitly requested.",
    "- Everything outside the immediate edit area must remain identical to the original.",
])

# Safety & ethics policy, adopted verbatim from the google-ai-studio image-editing app.
# Irrelevant to furniture-free interior renders (no people), but retained so this kit is
# reusable for portrait/people edits. Pass include_safety=True to append it to a prompt.
SAFETY_POLICY = "\n".join([
    "Safety & Ethics Policy:",
    "- You MUST fulfill requests to adjust skin tone, such as 'give me a tan', "
    "'make my skin darker', or 'make my skin lighter'. These are considered standard "
    "photo enhancements.",
    "- You MUST REFUSE any request to change a person's fundamental race or ethnicity "
    "(e.g., 'make me look Asian', 'change this person to be Black'). Do not perform these "
    "edits. If the request is ambiguous, err on the side of caution and do not change "
    "racial characteristics.",
])


def reference_scoping_note(label):
    """Scope a reference image to material/form only (ignore its angle/scene)."""
    return (
        f'Use the "{label}" reference ONLY for its material, color, veining, and form. '
        f"IGNORE its camera angle, orientation, floor, props, lighting, and background; "
        f"do NOT copy the angle or scene."
    )


def build_stage_prompt(user_request, edit_location=None, extra_guidelines=None,
                       references=None, include_safety=False):
    """Compose the structured stage prompt (preservation block always included).

    Set ``include_safety=True`` to append SAFETY_POLICY (for people/portrait edits).
    """
    parts = [
        "You are an expert architectural photo editor. Perform a natural, localized, "
        "photorealistic edit on the provided room image based on the user's request.",
        "",
        f"User Request: {user_request}",
    ]
    if edit_location:
        parts += ["", f"Edit Location: {edit_location}"]
    parts += [
        "",
        "Editing Guidelines:",
        "- The edit must be photorealistic and blend seamlessly with the surrounding area.",
        PRESERVATION_BLOCK,
    ]
    if references:
        parts += ["", "Reference images (material/form only):"]
        parts += [f"- {reference_scoping_note(label)}" for _, label in references]
    if extra_guidelines:
        parts += ["", extra_guidelines]
    if include_safety:
        parts += ["", SAFETY_POLICY]
    parts += ["", "Output: return ONLY the final edited image. Do not return text."]
    return "\n".join(parts)
