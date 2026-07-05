# Rule: OpenAI GPT-Image API Data Handling

1. **Dimensional Constraints**: All input images targeting `gpt-image` APIs must have width and height cleanly divisible by 16. Implement mathematical rounding `w - (w % 16)` prior to payload injection.
2. **Multiple References**: The `gpt-image` beta endpoint `client.images.edit()` accepts an array of images. Append the base image first, followed by up to 9 reference images. The provided mask applies strictly to the first image.
3. **Input Fidelity Exclusion**: Never pass the `input_fidelity` parameter to `gpt-image-2` or `chatgpt-image-latest`. Limit this parameter strictly to `gpt-image-1` and `gpt-image-1.5`.
4. **Alpha Transparency Masking**: Convert standard binary masking patterns (white=edit, black=preserve) into OpenAI format: an RGBA PNG with complete transparency `(alpha=0)` over the intended edit area and full opacity `(alpha=255)` over the preserved areas.
5. **Format Forcing**: Explicitly declare `response_format="b64_json"` in the API dictionary to ensure consistent byte parsing, overriding any API-level defaults prioritizing URL generation.
