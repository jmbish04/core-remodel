import type { ApiReferenceConfiguration } from '@scalar/hono-api-reference';
type Keys = keyof ApiReferenceConfiguration;
// Generate an error that prints the keys:
const k: Keys = "something_not_a_key";
