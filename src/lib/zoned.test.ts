import { describe, expect, it } from "vitest";
import { fromLocalInput, toLocalInput } from "./zoned";

describe("times in a zone", () => {
  it("reads a wall-clock time in Gaborone", () => {
    expect(fromLocalInput("2026-11-27T08:00", "Africa/Gaborone")?.toISOString()).toBe("2026-11-27T06:00:00.000Z");
    expect(toLocalInput(new Date("2026-11-27T06:00:00Z"), "Africa/Gaborone")).toBe("2026-11-27T08:00");
  });

  it("handles a zone with a change of offset", () => {
    expect(fromLocalInput("2026-07-01T12:00", "Europe/London")?.toISOString()).toBe("2026-07-01T11:00:00.000Z");
    expect(fromLocalInput("2026-01-01T12:00", "Europe/London")?.toISOString()).toBe("2026-01-01T12:00:00.000Z");
  });

  it("refuses what isn't a time", () => {
    expect(fromLocalInput("2026-02-30T08:00", "Africa/Gaborone")).toBeNull();
    expect(fromLocalInput("tomorrow", "Africa/Gaborone")).toBeNull();
  });
});
