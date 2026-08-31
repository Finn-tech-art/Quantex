// Astro config for the Quantex public/marketing site (home, blog, about,
// terms, privacy — see root CLAUDE.md and the /marketing README for why
// this is a *separate* project from /frontend rather than routes bolted
// onto the React app).
//
// Why Astro at all, and why `output: "static"`: the whole point of this
// site existing is to be indexed by Google (blog posts, the homepage) —
// a client-rendered React SPA doesn't reliably give crawlers real HTML.
// Astro's default "static" output mode does the opposite: every page below
// is compiled to a plain .html file at BUILD time (`npm run build`, see
// package.json), before any browser or crawler ever requests it. There's
// no server-side rendering step at request time and no client-side
// framework required for content to appear — a page here works even with
// JavaScript completely disabled. If a page ever needs real interactivity
// (e.g. a filter dropdown on the blog index), Astro "islands" let you drop
// a small React/vanilla-JS component into an otherwise-static page without
// converting the whole page back into an SPA — see Astro's docs on
// "client:*" directives if that's ever needed.
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  // The sitemap integration (and canonical-URL generation) needs to know
  // the real production domain to build absolute URLs. This is the ROOT
  // domain specifically (see the DNS plan discussed in chat: the React app
  // lives at trading.onquantex.com, this site takes the root). If the
  // domain ever changes, this is the one line to update — every page's
  // canonical/OG tags and the generated sitemap.xml all derive from it.
  site: "https://onquantex.com",
  integrations: [
    // Auto-generates /sitemap-index.xml + /sitemap-0.xml from every .astro
    // page found under src/pages at build time — this is what lets Google
    // Search Console discover every page (including new blog posts) without
    // us hand-maintaining a list. Submit the sitemap-index.xml URL in
    // Search Console once the site is live.
    sitemap(),
  ],
});
