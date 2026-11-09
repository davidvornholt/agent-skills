import { toBerlinClock } from "./day.ts";

export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);

/** Minutes as the report's script writes them, such as "1 h 5 min". */
export const minutesText = (minutes: number): string => {
  const whole = Math.round(minutes);
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
};

export const clockRange = (startMs: number, endMs: number): string => `${toBerlinClock(startMs)}–${toBerlinClock(endMs)}`;
