# Rule: Astro + React Frontend

## File Types & Attribute Rules

| File Extension | Attribute Style | Example                            |
| -------------- | --------------- | ---------------------------------- |
| `.astro`       | HTML attributes | `class="..."`, `for="..."`         |
| `.tsx` (React) | JSX attributes  | `className="..."`, `htmlFor="..."` |

## Astro Islands

React components in `.astro` pages require client directives:

```astro
<PhotoReviewApp client:load />     <!-- Hydrate immediately -->
<Gallery client:visible />          <!-- Hydrate when visible -->
```

## Typing API Responses

Always type `fetch` responses explicitly in React components:

```typescript
// ✅ CORRECT
const data = (await res.json()) as { images: ImageReview[] };

// ❌ WRONG — results in 'data is unknown' errors
const data = await res.json();
```

## Import Aliases

Use `@frontend/*` for frontend imports:

```typescript
import { Button } from "@frontend/components/ui/button";
```
