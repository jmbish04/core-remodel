import { getModelRegistry } from "../models";
import { getProvider } from "../providers";

export async function embed(
  env: Env,
  opts: {
    texts: string[];
    cacheTtl?: number;
  },
): Promise<number[][]> {
  const provider = getProvider(env);
  const model = getModelRegistry(env).embed;
  const result = await provider.invokeModel(
    model,
    { text: opts.texts },
    { cacheTtl: opts.cacheTtl },
  );

  return result.data;
}
