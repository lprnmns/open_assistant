const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

export type TemporalConfidence = "exact" | "approximate" | "ambiguous";

export type TemporalRange = {
  /**
   * Inclusive UTC start in milliseconds since epoch.
   */
  start: number;
  /**
   * Exclusive UTC end in milliseconds since epoch.
   */
  end: number;
  /**
   * Resolver confidence for downstream recall behavior.
   */
  confidence: TemporalConfidence;
  /**
   * Exact substring matched from the input query.
   */
  rawExpression: string;
};

export type ResolveTemporalRangeOptions = {
  /**
   * Reference time for relative phrases. Defaults to Date.now().
   */
  now?: number | Date;
  /**
   * Default east-positive UTC offset when the expression carries no timezone.
   * Defaults to 0 (UTC).
   */
  defaultUtcOffsetMinutes?: number;
};

type RangeResolver = (params: {
  match: RegExpExecArray;
  now: number;
  defaultUtcOffsetMinutes: number;
}) => TemporalRange | null;

const ENGLISH_WEEKDAYS = new Map<string, number>([
  ["monday", 0],
  ["tuesday", 1],
  ["wednesday", 2],
  ["thursday", 3],
  ["friday", 4],
  ["saturday", 5],
  ["sunday", 6],
]);

const TURKISH_WEEKDAYS = new Map<string, number>([
  ["pazartesi", 0],
  ["sali", 1],
  ["carsamba", 2],
  ["persembe", 3],
  ["cuma", 4],
  ["cumartesi", 5],
  ["pazar", 6],
]);

const MONTH_ALIASES = new Map<string, number>([
  ["january", 0],
  ["jan", 0],
  ["ocak", 0],
  ["february", 1],
  ["feb", 1],
  ["subat", 1],
  ["march", 2],
  ["mar", 2],
  ["mart", 2],
  ["april", 3],
  ["apr", 3],
  ["nisan", 3],
  ["may", 4],
  ["mayis", 4],
  ["june", 5],
  ["jun", 5],
  ["haziran", 5],
  ["july", 6],
  ["jul", 6],
  ["temmuz", 6],
  ["august", 7],
  ["aug", 7],
  ["agustos", 7],
  ["september", 8],
  ["sep", 8],
  ["sept", 8],
  ["eylul", 8],
  ["october", 9],
  ["oct", 9],
  ["ekim", 9],
  ["november", 10],
  ["nov", 10],
  ["kasim", 10],
  ["december", 11],
  ["dec", 11],
  ["aralik", 11],
]);

const RELATIVE_DAY_TOKENS = [
  "today",
  "yesterday",
  "tomorrow",
  "bug\\u00fcn",
  "bugun",
  "d\\u00fcn",
  "dun",
  "yar\\u0131n",
  "yarin",
  "\\u00f6nceki g\\u00fcn",
  "onceki gun",
  "evvelsi g\\u00fcn",
  "evvelsi gun",
].join("|");

const RELATIVE_WEEK_TOKENS = [
  "this week",
  "last week",
  "next week",
  "bu hafta",
  "ge\\u00e7en hafta",
  "gecen hafta",
  "gelecek hafta",
].join("|");

const MONTH_YEAR_TOKENS = [
  "this month",
  "last month",
  "bu ay",
  "ge\\u00e7en ay",
  "gecen ay",
  "this year",
  "last year",
  "bu y\\u0131l",
  "bu yil",
  "ge\\u00e7en y\\u0131l",
  "gecen yil",
].join("|");

const AGO_UNITS = [
  "day",
  "days",
  "week",
  "weeks",
  "hour",
  "hours",
  "g\\u00fcn",
  "gun",
  "hafta",
  "saat",
].join("|");

const AGO_DIRECTIONS = ["ago", "\\u00f6nce", "once"].join("|");

const WEEKDAY_PREFIXES = [
  "last",
  "this",
  "next",
  "ge\\u00e7en",
  "gecen",
  "bu",
  "gelecek",
].join("|");

const WEEKDAY_PATTERN = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "pazartesi",
  "sal\\u0131",
  "sali",
  "\\u00e7ar\\u015famba",
  "carsamba",
  "per\\u015fembe",
  "persembe",
  "cuma",
  "cumartesi",
  "pazar",
].join("|");

const MONTH_PATTERN = [
  "january",
  "jan",
  "ocak",
  "february",
  "feb",
  "\\u015fubat",
  "subat",
  "march",
  "mar",
  "mart",
  "april",
  "apr",
  "nisan",
  "may",
  "may\\u0131s",
  "mayis",
  "june",
  "jun",
  "haziran",
  "july",
  "jul",
  "temmuz",
  "august",
  "aug",
  "a\\u011fustos",
  "agustos",
  "september",
  "sep",
  "sept",
  "eyl\\u00fcl",
  "eylul",
  "october",
  "oct",
  "ekim",
  "november",
  "nov",
  "kas\\u0131m",
  "kasim",
  "december",
  "dec",
  "aral\\u0131k",
  "aralik",
]
  .sort((left, right) => right.length - left.length)
  .join("|");

const EXPRESSION_START = String.raw`(?<![\p{L}\p{N}_])`;
const EXPRESSION_END = String.raw`(?![\p{L}\p{N}_])`;
const TZ_SUFFIX = String.raw`(?:\s+(?<tz>(?:UTC|GMT)\s*[+-]\d{1,2}(?::\d{2})?|TSI|TRT|T\u00fcrkiye\s+saati|Turkiye\s+saati))?`;

const RESOLVERS: ReadonlyArray<{ regex: RegExp; resolve: RangeResolver }> = [
  {
    regex: new RegExp(
      String.raw`${EXPRESSION_START}(?<token>${RELATIVE_DAY_TOKENS})${TZ_SUFFIX}${EXPRESSION_END}`,
      "iu",
    ),
    resolve: ({ match, now, defaultUtcOffsetMinutes }) => {
      const token = normalizeToken(match.groups?.token);
      const offsetMinutes = resolveUtcOffsetMinutes(match.groups?.tz, defaultUtcOffsetMinutes);
      const todayStart = startOfLocalDay(now, offsetMinutes);

      switch (token) {
        case "today":
        case "bugun":
          return buildRange(todayStart, DAY_MS, "exact", match[0]);
        case "yesterday":
        case "dun":
          return buildRange(todayStart - DAY_MS, DAY_MS, "exact", match[0]);
        case "tomorrow":
        case "yarin":
          return buildRange(todayStart + DAY_MS, DAY_MS, "exact", match[0]);
        case "onceki gun":
        case "evvelsi gun":
          return buildRange(todayStart - 2 * DAY_MS, DAY_MS, "exact", match[0]);
        default:
          return null;
      }
    },
  },
  {
    regex: new RegExp(
      String.raw`${EXPRESSION_START}(?<token>${RELATIVE_WEEK_TOKENS})${TZ_SUFFIX}${EXPRESSION_END}`,
      "iu",
    ),
    resolve: ({ match, now, defaultUtcOffsetMinutes }) => {
      const token = normalizeToken(match.groups?.token);
      const offsetMinutes = resolveUtcOffsetMinutes(match.groups?.tz, defaultUtcOffsetMinutes);
      const weekStart = startOfLocalWeek(now, offsetMinutes);

      switch (token) {
        case "this week":
        case "bu hafta":
          return buildRange(weekStart, WEEK_MS, "exact", match[0]);
        case "last week":
        case "gecen hafta":
          return buildRange(weekStart - WEEK_MS, WEEK_MS, "exact", match[0]);
        case "next week":
        case "gelecek hafta":
          return buildRange(weekStart + WEEK_MS, WEEK_MS, "exact", match[0]);
        default:
          return null;
      }
    },
  },
  {
    regex: new RegExp(
      String.raw`${EXPRESSION_START}(?<token>${MONTH_YEAR_TOKENS})${TZ_SUFFIX}${EXPRESSION_END}`,
      "iu",
    ),
    resolve: ({ match, now, defaultUtcOffsetMinutes }) => {
      const token = normalizeToken(match.groups?.token);
      const offsetMinutes = resolveUtcOffsetMinutes(match.groups?.tz, defaultUtcOffsetMinutes);
      const localNow = getZonedDate(now, offsetMinutes);
      const year = localNow.getUTCFullYear();
      const month = localNow.getUTCMonth();

      switch (token) {
        case "this month":
        case "bu ay":
          return buildMonthRange(year, month, offsetMinutes, "exact", match[0]);
        case "last month":
        case "gecen ay":
          return buildMonthRange(year, month - 1, offsetMinutes, "exact", match[0]);
        case "this year":
        case "bu yil":
          return buildYearRange(year, offsetMinutes, "exact", match[0]);
        case "last year":
        case "gecen yil":
          return buildYearRange(year - 1, offsetMinutes, "exact", match[0]);
        default:
          return null;
      }
    },
  },
  {
    regex: new RegExp(
      String.raw`${EXPRESSION_START}(?<count>\d+)\s+(?<unit>${AGO_UNITS})\s+(?<direction>${AGO_DIRECTIONS})${TZ_SUFFIX}${EXPRESSION_END}`,
      "iu",
    ),
    resolve: ({ match, now, defaultUtcOffsetMinutes }) => {
      const count = Number(match.groups?.count);
      if (!Number.isInteger(count) || count <= 0) {
        return null;
      }

      const unit = normalizeToken(match.groups?.unit);
      const offsetMinutes = resolveUtcOffsetMinutes(match.groups?.tz, defaultUtcOffsetMinutes);
      if (unit === "hour" || unit === "hours" || unit === "saat") {
        return buildRange(now - count * HOUR_MS, HOUR_MS, "approximate", match[0]);
      }

      if (unit === "week" || unit === "weeks" || unit === "hafta") {
        const weekStart = startOfLocalWeek(now, offsetMinutes);
        return buildRange(weekStart - count * WEEK_MS, WEEK_MS, "exact", match[0]);
      }

      return buildRange(
        startOfLocalDay(now, offsetMinutes) - count * DAY_MS,
        DAY_MS,
        "exact",
        match[0],
      );
    },
  },
  {
    regex: new RegExp(
      String.raw`${EXPRESSION_START}(?<prefix>${WEEKDAY_PREFIXES})\s+(?<weekday>${WEEKDAY_PATTERN})${TZ_SUFFIX}${EXPRESSION_END}`,
      "iu",
    ),
    resolve: ({ match, now, defaultUtcOffsetMinutes }) => {
      const prefix = normalizeToken(match.groups?.prefix);
      const weekday = resolveWeekday(match.groups?.weekday);
      if (weekday === undefined) {
        return null;
      }

      const offsetMinutes = resolveUtcOffsetMinutes(match.groups?.tz, defaultUtcOffsetMinutes);
      const weekStart = startOfLocalWeek(now, offsetMinutes);
      if (prefix === "last" || prefix === "gecen") {
        return buildRange(weekStart - WEEK_MS + weekday * DAY_MS, DAY_MS, "exact", match[0]);
      }
      if (prefix === "this" || prefix === "bu") {
        return buildRange(weekStart + weekday * DAY_MS, DAY_MS, "exact", match[0]);
      }
      if (prefix === "next" || prefix === "gelecek") {
        return buildRange(weekStart + WEEK_MS + weekday * DAY_MS, DAY_MS, "exact", match[0]);
      }
      return null;
    },
  },
  {
    regex: new RegExp(
      String.raw`${EXPRESSION_START}(?<year>\d{4})-(?<month>\d{1,2})-(?<day>\d{1,2})${TZ_SUFFIX}${EXPRESSION_END}`,
      "iu",
    ),
    resolve: ({ match, defaultUtcOffsetMinutes }) =>
      buildNumericDateRange(match, defaultUtcOffsetMinutes, "exact"),
  },
  {
    regex: new RegExp(
      String.raw`${EXPRESSION_START}(?<day>\d{1,2})[./](?<month>\d{1,2})[./](?<year>\d{4})${TZ_SUFFIX}${EXPRESSION_END}`,
      "iu",
    ),
    resolve: ({ match, defaultUtcOffsetMinutes }) =>
      buildNumericDateRange(match, defaultUtcOffsetMinutes, "exact"),
  },
  {
    regex: new RegExp(
      String.raw`${EXPRESSION_START}(?<day>\d{1,2})\s+(?<monthName>${MONTH_PATTERN})(?:\s+(?<year>\d{4}))?${TZ_SUFFIX}${EXPRESSION_END}`,
      "iu",
    ),
    resolve: ({ match, now, defaultUtcOffsetMinutes }) =>
      buildNamedDateRange(match, now, defaultUtcOffsetMinutes, match.groups?.year ? "exact" : "approximate"),
  },
  {
    regex: new RegExp(
      String.raw`${EXPRESSION_START}(?<monthName>${MONTH_PATTERN})\s+(?<day>\d{1,2})(?:,\s*|\s+)(?<year>\d{4})${TZ_SUFFIX}${EXPRESSION_END}`,
      "iu",
    ),
    resolve: ({ match, now, defaultUtcOffsetMinutes }) =>
      buildNamedDateRange(match, now, defaultUtcOffsetMinutes, "exact"),
  },
];

export function resolveTemporalRange(
  text: string,
  options: ResolveTemporalRangeOptions = {},
): TemporalRange | null {
  if (!text.trim()) {
    return null;
  }

  const now = normalizeNow(options.now);
  const defaultUtcOffsetMinutes = options.defaultUtcOffsetMinutes ?? 0;

  for (const resolver of RESOLVERS) {
    const match = resolver.regex.exec(text);
    if (!match) {
      continue;
    }
    const range = resolver.resolve({ match, now, defaultUtcOffsetMinutes });
    if (range) {
      return range;
    }
  }

  return null;
}

function normalizeNow(now: number | Date | undefined): number {
  if (typeof now === "number" && Number.isFinite(now)) {
    return now;
  }
  if (now instanceof Date) {
    return now.getTime();
  }
  return Date.now();
}

function normalizeToken(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/\u0131/gu, "i");
}

function resolveUtcOffsetMinutes(raw: string | undefined, fallbackMinutes: number): number {
  if (!raw) {
    return fallbackMinutes;
  }

  const normalized = normalizeToken(raw);
  if (normalized === "tsi" || normalized === "trt" || normalized === "turkiye saati") {
    return 180;
  }

  const canonical = normalized.replace(/^gmt/u, "utc").replace(/\s+/gu, "");
  const match = /^utc([+-])(\d{1,2})(?::([0-5]\d))?$/u.exec(canonical);
  if (!match) {
    return fallbackMinutes;
  }

  const sign = match[1] === "+" ? 1 : -1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? "0");
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return fallbackMinutes;
  }
  if (hours > 14 || (hours === 14 && minutes !== 0)) {
    return fallbackMinutes;
  }

  const totalMinutes = sign * (hours * 60 + minutes);
  if (totalMinutes < -12 * 60 || totalMinutes > 14 * 60) {
    return fallbackMinutes;
  }
  return totalMinutes;
}

function resolveWeekday(raw: string | undefined): number | undefined {
  const normalized = normalizeToken(raw);
  return ENGLISH_WEEKDAYS.get(normalized) ?? TURKISH_WEEKDAYS.get(normalized);
}

function buildRange(
  start: number,
  durationMs: number,
  confidence: TemporalConfidence,
  rawExpression: string,
): TemporalRange {
  return {
    start,
    end: start + durationMs,
    confidence,
    rawExpression: rawExpression.trim(),
  };
}

function buildMonthRange(
  year: number,
  monthIndex: number,
  offsetMinutes: number,
  confidence: TemporalConfidence,
  rawExpression: string,
): TemporalRange {
  const start = Date.UTC(year, monthIndex, 1) - offsetMinutes * MINUTE_MS;
  const end = Date.UTC(year, monthIndex + 1, 1) - offsetMinutes * MINUTE_MS;
  return { start, end, confidence, rawExpression: rawExpression.trim() };
}

function buildYearRange(
  year: number,
  offsetMinutes: number,
  confidence: TemporalConfidence,
  rawExpression: string,
): TemporalRange {
  const start = Date.UTC(year, 0, 1) - offsetMinutes * MINUTE_MS;
  const end = Date.UTC(year + 1, 0, 1) - offsetMinutes * MINUTE_MS;
  return { start, end, confidence, rawExpression: rawExpression.trim() };
}

function buildNumericDateRange(
  match: RegExpExecArray,
  defaultUtcOffsetMinutes: number,
  confidence: TemporalConfidence,
): TemporalRange | null {
  const year = Number(match.groups?.year);
  const month = Number(match.groups?.month);
  const day = Number(match.groups?.day);
  if (!isValidDate(year, month, day)) {
    return null;
  }

  const offsetMinutes = resolveUtcOffsetMinutes(match.groups?.tz, defaultUtcOffsetMinutes);
  return buildRange(
    Date.UTC(year, month - 1, day) - offsetMinutes * MINUTE_MS,
    DAY_MS,
    confidence,
    match[0],
  );
}

function buildNamedDateRange(
  match: RegExpExecArray,
  now: number,
  defaultUtcOffsetMinutes: number,
  confidence: TemporalConfidence,
): TemporalRange | null {
  const day = Number(match.groups?.day);
  const monthName = normalizeToken(match.groups?.monthName);
  const monthIndex = MONTH_ALIASES.get(monthName);
  if (monthIndex === undefined) {
    return null;
  }

  const offsetMinutes = resolveUtcOffsetMinutes(match.groups?.tz, defaultUtcOffsetMinutes);
  const localNow = getZonedDate(now, offsetMinutes);
  const explicitYear = match.groups?.year;
  const year = explicitYear ? Number(explicitYear) : localNow.getUTCFullYear();
  if (!isValidDate(year, monthIndex + 1, day)) {
    return null;
  }

  return buildRange(
    Date.UTC(year, monthIndex, day) - offsetMinutes * MINUTE_MS,
    DAY_MS,
    confidence,
    match[0],
  );
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

function startOfLocalDay(utcMs: number, offsetMinutes: number): number {
  const local = getZonedDate(utcMs, offsetMinutes);
  return (
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) -
    offsetMinutes * MINUTE_MS
  );
}

function startOfLocalWeek(utcMs: number, offsetMinutes: number): number {
  const dayStart = startOfLocalDay(utcMs, offsetMinutes);
  const weekday = mondayBasedWeekday(getZonedDate(dayStart, offsetMinutes).getUTCDay());
  return dayStart - weekday * DAY_MS;
}

function getZonedDate(utcMs: number, offsetMinutes: number): Date {
  return new Date(utcMs + offsetMinutes * MINUTE_MS);
}

function mondayBasedWeekday(sundayBased: number): number {
  return (sundayBased + 6) % 7;
}
