"""Pipeline stages — each module exposes a ``run(...)`` that edits one image.

Default order (mirrors the deployed Worker flow):
  base -> rough_in -> finish -> interaction -> synthesis -> mood_board
"""
