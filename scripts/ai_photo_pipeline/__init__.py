"""Staged AI render pipeline (base -> rough-in -> finish -> interaction -> synthesis -> mood board).

Importable package backing scripts/batch_image_edit.py. Mirrors the deployed
Cloudflare Worker's staged render flow (src/backend/services/render/*), but calls
each provider (Gemini / Fal / Replicate) directly since this is a local harness.
"""
