/**
 * Fails when text breaks the copy rules in docs/ICTD_BUILD.md and
 * brand/BRAND.md: plain and confident, so
 * - no em dashes anywhere in the source, docs or brand pack;
 * - no exclamation marks in what customers and staff read (pages,
 *   components and emails).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src", "prisma", "scripts", "docs", "deploy", "brand/BRAND.md", "README.md"];
const SKIP = new Set(["node_modules", ".next", "migrations"]);
const TEXT = /\.(tsx?|mjs|md|json|prisma|css|sql|sh|conf)$/;
const EM_DASH = String.fromCharCode(0x2014);
/** Text people read lives here. */
const UI = /^src[\\/](app|components|server[\\/]email)[\\/].*\.tsx?$/;
/** An exclamation mark ending a sentence in a string or in JSX text. */
const EXCLAIM = /[A-Za-z]!(?=["'`<]|\s+[A-Z"'`<]|$)/;

function* files(path: string): Generator<string> {
  const s = statSync(path);
  if (s.isFile()) {
    if (TEXT.test(path)) yield path;
    return;
  }
  for (const name of readdirSync(path)) {
    if (SKIP.has(name)) continue;
    yield* files(join(path, name));
  }
}

const problems: string[] = [];
for (const root of ROOTS) {
  for (const file of files(root)) {
    const ui = UI.test(file) && !/\.test\.tsx?$/.test(file);
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (line.includes(EM_DASH)) problems.push(`${file}:${i + 1} has an em dash`);
        if (ui && EXCLAIM.test(line)) problems.push(`${file}:${i + 1} has an exclamation mark`);
      });
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} copy problem(s). Copy is plain and confident: no exclamation marks and no em dashes (docs/ICTD_BUILD.md).`);
  process.exit(1);
}
console.log("Copy check passed.");
