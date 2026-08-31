// Astro's Content Layer API config (Astro 5+). Defines the shape every
// file under src/content/blog/ must match — get this wrong and `npm run
// build` fails at build time with a clear schema error, rather than a
// broken page shipping silently. To add a new post, drop a new .md file
// into src/content/blog/ with frontmatter matching this schema; nothing
// here needs to change.
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishDate: z.date(),
  }),
});

export const collections = { blog };
