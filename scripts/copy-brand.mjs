// Copies the brand pack's logos, PNGs and web icons into public/brand so
// pages and emails can use them. brand/ stays the only source;
// public/brand is ignored by git and rebuilt before every dev start and build.
import { cpSync, mkdirSync, rmSync } from "node:fs";

rmSync("public/brand", { recursive: true, force: true });
mkdirSync("public/brand", { recursive: true });
cpSync("brand/logo", "public/brand/logo", { recursive: true });
cpSync("brand/png", "public/brand/png", { recursive: true });
cpSync("brand/icons/web", "public/brand/icons", { recursive: true });
