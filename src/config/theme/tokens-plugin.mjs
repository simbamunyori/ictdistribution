// Turns brand/tokens/tokens.json (the brand pack's own file, used as it is)
// into the --t-* custom properties the Tailwind names in globals.css read.
// Nothing here holds a colour of its own: change the brand in that file.
import plugin from "tailwindcss/plugin";
import tokens from "../../../brand/tokens/tokens.json" with { type: "json" };

/**
 * The app's names for the brand pack's semantic colours (brand/DEVELOPMENT.md):
 * primary actions are Amber with Ink text, links and focus are Cobalt, and
 * Amber is never text on a light background (brand-text is).
 */
function scheme(c) {
  const app = {
    bg: c.bg,
    surface: c.surface,
    "surface-raised": c["surface-raised"],
    border: c.border,
    text: c.text,
    "text-body": c.text,
    "text-muted": c["text-muted"],
    primary: c.brand,
    "primary-hover": c["brand-hover"],
    "on-primary": c["on-brand"],
    "primary-text": c["accent-text"],
    accent: c.accent,
    "on-accent": c["on-accent"],
    highlight: c.brand,
    "on-highlight": c["on-brand"],
    "highlight-text": c["brand-text"],
    success: c.success,
    warning: c.warning,
    danger: c.danger,
    info: c.info,
    focus: c.focus,
  };
  const vars = {};
  for (const [k, v] of Object.entries(app)) vars[`--t-${k}`] = v;
  for (const tone of ["primary", "accent", "success", "warning", "danger", "info", "highlight"]) {
    vars[`--t-${tone}-soft`] = `color-mix(in srgb, var(--t-${tone}) 12%, var(--t-bg))`;
  }
  return vars;
}

const px = (n) => `${n}px`;
const shared = {
  "--t-radius-sm": px(tokens.radius.sm),
  "--t-radius-md": px(tokens.radius.md),
  "--t-radius-lg": px(tokens.radius.lg),
  // Ink panels (the header and footer) look the same in both themes.
  "--t-ink": tokens.palette.ink,
  "--t-fog": tokens.palette.fog,
  "--t-ink-on-dark": tokens.dark["text-muted"],
};

export default plugin(({ addBase }) => {
  addBase({
    ":root": { ...shared, ...scheme(tokens.light), "color-scheme": "light" },
    ":root[data-theme='dark']": { ...scheme(tokens.dark), "color-scheme": "dark" },
    "@media (prefers-color-scheme: dark)": {
      ":root:not([data-theme='light'])": { ...scheme(tokens.dark), "color-scheme": "dark" },
    },
  });
});
