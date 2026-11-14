// How the report document writes the times and durations that are text, such as a tile's note. Values that are only a number, such as a tile's value, stay numbers for Postlude to write.

import { toBerlinClock } from "./day.ts";

/** Minutes as the report writes them, such as "1 h 5 min". */
export const minutesText = (minutes: number): string => {
  const whole = Math.round(minutes);
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
};

export const clockRange = (startMs: number, endMs: number): string => `${toBerlinClock(startMs)}–${toBerlinClock(endMs)}`;

/** A duration as the report writes it: seconds under a minute, days and hours over a day. */
export const durationText = (seconds: number): string => {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 24 * 60) return minutesText(minutes);
  const hours = Math.round(minutes / 60);
  return hours % 24 === 0 ? `${hours / 24} d` : `${Math.floor(hours / 24)} d ${hours % 24} h`;
};

export const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
