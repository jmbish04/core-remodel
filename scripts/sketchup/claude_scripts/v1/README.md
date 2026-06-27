# SketchUp Script Utilities (v1)

This folder contains Python scripts that interact with the SketchUp MCP Server to build 3D models.

## Troubleshooting: `401 Unauthorized`
If you encounter a `401 Unauthorized` error (specifically `httpx.HTTPStatusError: Client error '401 Unauthorized'`) when running any of the builder scripts, your **Trimble API Token has expired**.

The JWT tokens from Trimble typically expire after a few hours.

### How to Refresh Your Token

1. **Log in to SketchUp:**
   Go to [app.sketchup.com](https://app.sketchup.com) (or the relevant developer portal/MCP configuration page) and log in.

2. **Extract your `Bearer` token:**
   Open your browser's Developer Tools (Network Tab). Look for an API request (e.g., to `api.sketchup.com` or `trimble.com`), inspect its headers, and copy the `Authorization: Bearer <TOKEN>` value. You only need the `eyJ...` token string itself.

3. **Update your Token CLI Store:**
   Run the following command in your terminal, replacing `<NEW_TOKEN>` with the token you just copied:
   ```bash
   tokens set TRIMBLE_API_KEY "<NEW_TOKEN>"
   ```

*(Alternatively, you can place it in a `.env` file at the root of the project as `TRIMBLE_API_KEY=<NEW_TOKEN>`)*

Once updated, the scripts will automatically pull the new token via `sketchup_secrets.py` and resume working correctly!

## Files in this Directory
- `build_connected_baseline.py`
- `build_phase2_kitchen_swap.py`
- `build_phase3_primary_suite.py`
- `sketchup_secrets.py` (Helper script for managing credentials securely)
