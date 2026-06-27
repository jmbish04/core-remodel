import { createGeminiAiGatewayClient } from "@backend/services/render/providers/gemini-stage-provider";

export async function processImageEdit(
  env: Env,
  prompt: string,
  base64Images: { data: string; mimeType: string }[],
): Promise<string | null> {
  const ai = await createGeminiAiGatewayClient(env);

  const input = [
    { type: "text", text: prompt },
    ...base64Images.map((img) => ({
      type: "image",
      mime_type: img.mimeType,
      data: img.data,
    })),
  ];

  const interaction = await (ai as any).interactions.create({
    model: "gemini-3-pro-image-preview",
    input: input as any,
    response_format: {
      type: "image",
      image_size: "4K",
    },
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
