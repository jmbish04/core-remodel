"""Provider dispatch: resolve provider+model from STAGE_MODELS, format the prompt
for that provider's expected style, and run the stage."""
from .. import config
from ..prompts import build_stage_prompt
from .fal import fal_run
from .gemini import gemini_generate
from .openai import openai_edit
from .replicate import replicate_run

PROVIDERS = {
    "gemini": gemini_generate,
    "fal": fal_run,
    "replicate": replicate_run,
    "openai": openai_edit,
}


def model_for(stage_key, provider):
    """Resolve the model slug for a stage + provider (Gemini is uniform)."""
    if provider == "gemini":
        return config.GEMINI_MODEL
    if provider == "fal":
        return config.FAL_MODELS.get(stage_key) or config.FAL_MODELS["finish"]
    if provider == "replicate":
        return config.REPLICATE_MODELS.get(stage_key) or config.REPLICATE_MODELS["finish"]
    if provider == "openai":
        return config.OPENAI_MODELS.get(stage_key) or config.OPENAI_MODELS["finish"]
    raise ValueError(f"Unknown provider: {provider}")


def run_model(provider, model, prompt, image_bytes, references, env, mask=None):
    """Low-level dispatch: call a provider by name; return output image bytes."""
    try:
        runner = PROVIDERS[provider]
    except KeyError:
        raise ValueError(f"Unknown provider: {provider}")
    return runner(model, prompt, image_bytes, references, env, mask)


def format_prompt(provider, model, stage_intent):
    """Format a stage intent into the prompt string the provider expects."""
    if provider == "gemini":
        return build_stage_prompt(
            user_request=stage_intent["user_request"],
            edit_location=stage_intent.get("edit_location"),
            extra_guidelines=stage_intent.get("extra_guidelines"),
            references=stage_intent.get("references"),
        )
    if provider == "fal":
        if model.startswith("bria/"):
            # Bria FIBO-Edit: short, direct instruction; it promptifies to VGL JSON itself.
            return stage_intent["user_request"]
        parts = [stage_intent["user_request"]]
        if stage_intent.get("extra_guidelines"):
            parts.append(stage_intent["extra_guidelines"])
        parts.append(
            "PRESERVE the flooring, walls, windows, openings, ceiling, room dimensions, "
            "and camera angle. Do NOT crop, zoom, or re-frame."
        )
        return "\n\n".join(parts)
    if provider == "openai":
        parts = [stage_intent["user_request"]]
        if stage_intent.get("extra_guidelines"):
            parts.append(stage_intent["extra_guidelines"])
        parts.append(
            "Preserve the flooring, walls, windows, openings, ceiling, room dimensions, "
            "and camera angle; only change what the request describes."
        )
        text = "\n\n".join(parts)
        return text[:1000] if model == "dall-e-2" else text  # dall-e-2 prompt cap
    if provider == "replicate":
        # Depth-Pro / Kontext-Max: simple prompt; the depth map handles spatial constraints.
        return stage_intent["user_request"]
    return stage_intent["user_request"]


def dispatch(stage_key, stage_intent, image_bytes, references, env, mask=None):
    """Run one stage through its configured provider, formatting the prompt per-model.

    `mask` (PNG bytes, white=edit) enables a surgical masked edit on mask-capable
    models (e.g. Fal fill / Bria FIBO); ignored by models that don't support it.
    """
    provider = config.STAGE_MODELS[stage_key]
    model = model_for(stage_key, provider)
    print(f"  -> {stage_key}: {provider} ({model}){' [masked]' if mask else ''}")

    prompt = format_prompt(provider, model, stage_intent)
    return run_model(provider, model, prompt, image_bytes, references, env, mask)
