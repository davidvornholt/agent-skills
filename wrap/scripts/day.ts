// The journal day runs from 04:00 to 04:00 Europe/Berlin, so it lasts 23 or 25 hours when daylight saving time changes.

export const TIME_ZONE = "Europe/Berlin";
const DAY_START_HOUR = 4;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export type DayWindow = {
  readonly day: string;
  readonly start: string;
  readonly end: string;
  readonly startMs: number;
  readonly endMs: number;
};

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZoneName: "longOffset",
});

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number; offset: string };

const localParts = (ms: number): LocalParts => {
  const parts = Object.fromEntries(partsFormatter.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  // longOffset prints "GMT" without digits when the offset is zero.
  const offset = /^GMT([+-]\d{2}:\d{2})$/.exec(parts.timeZoneName ?? "")?.[1] ?? "+00:00";
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    offset,
  };
};

const offsetMs = (offset: string): number => {
  const sign = offset.startsWith("-") ? -1 : 1;
  const [hours, minutes] = offset.slice(1).split(":").map(Number);
  return sign * ((hours ?? 0) * 60 + (minutes ?? 0)) * 60_000;
};

const pad = (value: number): string => String(value).padStart(2, "0");

const formatDate = (year: number, month: number, day: number): string => `${year}-${pad(month)}-${pad(day)}`;

export const isDay = (value: string): boolean => {
  const match = DAY_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

export const addDays = (day: string, count: number): string => {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(year, month - 1, date + count));
  return formatDate(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
};

// 04:00 always exists and is unambiguous in Berlin, because the clocks change between 02:00 and 03:00.
const berlinWallTimeToMs = (day: string, hour: number): number => {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const asUtc = Date.UTC(year, month - 1, date, hour);
  const firstGuess = asUtc - offsetMs(localParts(asUtc).offset);
  return asUtc - offsetMs(localParts(firstGuess).offset);
};

export const toBerlinIso = (ms: number): string => {
  const parts = localParts(ms);
  return `${formatDate(parts.year, parts.month, parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}${parts.offset}`;
};

export const toBerlinClock = (ms: number): string => {
  const parts = localParts(ms);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
};

export const toBerlinDate = (ms: number): string => {
  const parts = localParts(ms);
  return formatDate(parts.year, parts.month, parts.day);
};

export const dayWindow = (day: string): DayWindow => {
  if (!isDay(day)) throw new Error(`Not a calendar date: ${day}`);
  const startMs = berlinWallTimeToMs(day, DAY_START_HOUR);
  const endMs = berlinWallTimeToMs(addDays(day, 1), DAY_START_HOUR);
  return { day, start: toBerlinIso(startMs), end: toBerlinIso(endMs), startMs, endMs };
};

export const journalDayAt = (ms: number): string => {
  const parts = localParts(ms);
  const date = formatDate(parts.year, parts.month, parts.day);
  return parts.hour < DAY_START_HOUR ? addDays(date, -1) : date;
};
