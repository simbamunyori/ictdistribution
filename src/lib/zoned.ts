/**
 * Wall-clock times in a time zone, for date and time fields. Staff type
 * "2026-11-27T08:00" meaning eight o'clock in Gaborone, whatever the
 * server's own zone.
 */

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** The parts of a moment as a clock in `timeZone` shows them. */
function wallClock(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return { y: +parts.year, mo: +parts.month, d: +parts.day, h: +parts.hour, mi: +parts.minute, s: +parts.second };
}

/** "2026-11-27T08:00" in `timeZone` as a Date, or null when it isn't a valid time. */
export function fromLocalInput(value: string, timeZone: string): Date | null {
  const m = LOCAL.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(guess) || new Date(guess).getUTCDate() !== d) return null;
  // Shift by the zone's offset at that moment; twice settles it across a change of offset.
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const w = wallClock(new Date(t), timeZone);
    t += guess - Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  }
  return new Date(t);
}

/** A Date as "2026-11-27T08:00" in `timeZone`, for a datetime-local field. */
export function toLocalInput(date: Date, timeZone: string): string {
  const w = wallClock(date, timeZone);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${w.y}-${p(w.mo)}-${p(w.d)}T${p(w.h)}:${p(w.mi)}`;
}

/** "27 Nov 2026, 08:00", as a clock in `timeZone` shows it. */
export function formatDateTime(date: Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

export function formatDate(date: Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short", year: "numeric" }).format(date);
}
