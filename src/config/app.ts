/**
 * Fixed facts about the business. Anything that changes per deployment
 * comes from the environment (src/server/env.ts); anything staff decide
 * lives in the admin area.
 */
export const company = {
  /** How the business appears to customers. */
  name: "ICT Distribution Africa",
  shortName: "ICTD",
  domain: "ictdistribution.africa",
  tagline: "ICT products for Africa, at the right price, delivered.",
  /** Who builds and hosts the platform. Named only in the footer. */
  builtBy: "Fourth Generation Technologies",
  /** How the admin area writes amounts and dates for staff. */
  staffLocale: "en-BW",
} as const;

/** Where the team works: scheduled jobs and the admin area use it. */
export const DEFAULT_TIME_ZONE = "Africa/Gaborone";
