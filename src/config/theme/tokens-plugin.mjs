// Turns brand/tokens/tokens.json into CSS custom properties for Tailwind.
// Nothing here holds a value of its own: change the brand in that file.
import plugin from "tailwindcss/plugin";
import tokens from "../../../brand/tokens/tokens.json" with { type: "json" };

const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** One scheme's colours as --t-* variables, plus soft tints for status boxes. */
function scheme(colours) {
  const vars = {};
  for (const [k, v] of Object.entries(colours)) vars[`--t-${kebab(k)}`] = v;
  for (const tone of ["primary", "success", "warning", "danger", "info", "highlight"]) {
    vars[`--t-${tone}-soft`] = `color-mix(in srgb, var(--t-${tone}) 12%, var(--t-bg))`;
  }
  return vars;
}

const shared = {
  "--t-font": tokens.font.family,
  "--t-tracking-headline": tokens.font.headlineTracking,
  "--t-tracking-label": tokens.font.labelTracking,
  "--t-radius-sm": tokens.radius.sm,
  "--t-radius-md": tokens.radius.md,
  "--t-radius-lg": tokens.radius.lg,
  "--t-forest": tokens.brand.forest,
  "--t-sand": tokens.brand.sand,
  "--t-ink-on-dark": tokens.brand.inkOnDark,
};
for (const [k, v] of Object.entries(tokens.space)) shared[`--t-space-${k}`] = v;

export default plugin(({ addBase }) => {
  addBase({
    ":root": { ...shared, ...scheme(tokens.light), "color-scheme": "light" },
    ":root[data-theme='dark']": { ...scheme(tokens.dark), "color-scheme": "dark" },
    "@media (prefers-color-scheme: dark)": {
      ":root:not([data-theme='light'])": { ...scheme(tokens.dark), "color-scheme": "dark" },
    },
  });
});
