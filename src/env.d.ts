/// <reference path="../worker-configuration.d.ts" />

declare module "*?raw" {
  const content: string;
  export default content;
}

declare module "*.wasm" {
  const value: WebAssembly.Module;
  export default value;
}
