import { createGeminiAiGatewayClient } from "@backend/services/render/providers/gemini-stage-provider";

export async function processImageEdit(
  env: Env,
  prompt: string,
  base64Images: { data: string; mimeType: string }[],
): Promise<string | null> {
  const ai = await createGeminiAiGatewayClient(env);

  let finalPrompt = prompt;
  if (base64Images.length > 1) {
    // Inpainting / Semantic masking template
    finalPrompt = `Using the provided image and mask, change only the area covered by the mask to be: ${prompt}. Keep everything else in the image exactly the same, preserving the original style, lighting, and composition.`;
  } else {
    // Adding/removing elements template
    finalPrompt = `Using the provided image, please modify it based on this request: ${prompt}. Ensure the change integrates naturally with the scene's lighting, shadows, and composition.`;
  }

  const input = [
    { type: "text", text: finalPrompt },
    ...base64Images.map((img) => ({
      type: "image",
      mime_type: img.mimeType,
      data: img.data,
    })),
  ];

  const interaction = await (ai as any).interactions.create({
    model: "gemini-3.1-flash-image",
    input: input as any,
  });

  for (const step of interaction.steps as Array<any>) {
    if (step.type === "model_output") {
      for (const contentBlock of step.content as Array<any>) {
        if (contentBlock.type === "image") {
          return contentBlock.data as string;
        }
      }
    }
  }

  return null;
}
