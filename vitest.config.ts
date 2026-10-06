import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@brand": fileURLToPath(new URL("./brand", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    // .env too, for TEST_DATABASE_URL; what is already set wins.
    env: { ...loadEnv("test", process.cwd(), ""), ...process.env } as Record<string, string>,
    // Empties and seeds TEST_DATABASE_URL first, when it is set.
    globalSetup: ["tests/global-setup.ts"],
    // Integration tests share one database; running files one at a time keeps them independent.
    fileParallelism: false,
  },
});
