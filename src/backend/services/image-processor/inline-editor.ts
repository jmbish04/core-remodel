import { GoogleGenAI } from "@google/genai";

export async function processImageEdit(
  env: Env,
  prompt: string,
  base64Images: { data: string; mimeType: string }[],
): Promise<string | null> {
  const geminiApiKey = await env.GEMINI_API_KEY.get();
  const cloudflareAccountId = await env.CLOUDFLARE_ACCOUNT_ID.get();

  if (!geminiApiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  if (!cloudflareAccountId) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID is not configured");
  }

  const ai = new GoogleGenAI({
    apiKey: geminiApiKey,
    httpOptions: {
      baseUrl: `https://gateway.ai.cloudflare.com/v1/${cloudflareAccountId}/${env.AI_GATEWAY_ID}/google-ai-studio`,
    },
  });

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
