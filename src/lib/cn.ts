import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      // The type scale in src/config/theme/tokens.json, so tailwind-merge knows text-title is a size, not a colour.
      "font-size": [{ text: ["display", "title", "headline", "body", "callout", "caption"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
