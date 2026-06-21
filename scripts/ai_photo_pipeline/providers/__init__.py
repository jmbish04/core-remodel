"""Provider package — one module per provider + a dispatcher.

The public API is re-exported here so callers keep doing:
    from ..providers import dispatch, ref, save_image
    from ai_photo_pipeline.providers import _read
"""
from ._io import _download, _guess_mime, _read, ref, save_image
from .dispatch import PROVIDERS, dispatch, format_prompt, model_for, run_model
from .fal import fal_run
from .gemini import gemini_generate
from .openai import openai_edit
from .replicate import replicate_run

__all__ = [
    "_read",
    "_guess_mime",
    "_download",
    "save_image",
    "ref",
    "gemini_generate",
    "fal_run",
    "replicate_run",
    "openai_edit",
    "PROVIDERS",
    "model_for",
    "run_model",
    "format_prompt",
    "dispatch",
]
