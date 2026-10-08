import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // A leading underscore marks a parameter an interface requires but this implementation doesn't use.
    rules: { "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }] },
  },
  globalIgnores(["node_modules/**", ".next/**", "out/**", "build/**", "brand/**", "next-env.d.ts", "public/brand/**"]),
]);

export default eslintConfig;
