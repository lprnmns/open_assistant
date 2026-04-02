import { describe, expect, it } from "vitest";
import {
  resolveTemporalRange,
  type TemporalConfidence,
} from "./temporal-resolver.js";

const NOW = Date.UTC(2026, 2, 19, 12, 0, 0, 0); // 2026-03-19T12:00:00.000Z

function expectRange(
  expression: string,
  expected: {
    start: string;
    end: string;
    rawExpression?: string;
    confidence?: TemporalConfidence;
  },
  options?: {
    defaultUtcOffsetMinutes?: number;
  },
) {
  const result = resolveTemporalRange(expression, {
    now: NOW,
    defaultUtcOffsetMinutes: options?.defaultUtcOffsetMinutes,
  });

  expect(result).not.toBeNull();
  expect(new Date(result!.start).toISOString()).toBe(expected.start);
  expect(new Date(result!.end).toISOString()).toBe(expected.end);
  expect(result!.rawExpression).toBe(expected.rawExpression ?? expression);
  expect(result!.confidence).toBe(expected.confidence ?? "exact");
}

describe("resolveTemporalRange", () => {
  it("resolves today in English", () => {
    expectRange("today", {
      start: "2026-03-19T00:00:00.000Z",
      end: "2026-03-20T00:00:00.000Z",
    });
  });

  it("resolves bugun in Turkish", () => {
    expectRange("bug\u00fcn", {
      start: "2026-03-19T00:00:00.000Z",
      end: "2026-03-20T00:00:00.000Z",
    });
  });

  it("resolves bugun in ASCII Turkish", () => {
    expectRange("bugun", {
      start: "2026-03-19T00:00:00.000Z",
      end: "2026-03-20T00:00:00.000Z",
    });
  });

  it("resolves yesterday in English", () => {
    expectRange("yesterday", {
      start: "2026-03-18T00:00:00.000Z",
      end: "2026-03-19T00:00:00.000Z",
    });
  });

  it("resolves dun in Turkish", () => {
    expectRange("d\u00fcn", {
      start: "2026-03-18T00:00:00.000Z",
      end: "2026-03-19T00:00:00.000Z",
    });
  });

  it("resolves dun in ASCII Turkish", () => {
    expectRange("dun", {
      start: "2026-03-18T00:00:00.000Z",
      end: "2026-03-19T00:00:00.000Z",
    });
  });

  it("resolves onceki gun", () => {
    expectRange("\u00f6nceki g\u00fcn", {
      start: "2026-03-17T00:00:00.000Z",
      end: "2026-03-18T00:00:00.000Z",
    });
  });

  it("resolves tomorrow", () => {
    expectRange("tomorrow", {
      start: "2026-03-20T00:00:00.000Z",
      end: "2026-03-21T00:00:00.000Z",
    });
  });

  it("resolves bu hafta", () => {
    expectRange("bu hafta", {
      start: "2026-03-16T00:00:00.000Z",
      end: "2026-03-23T00:00:00.000Z",
    });
  });

  it("resolves gecen hafta", () => {
    expectRange("ge\u00e7en hafta", {
      start: "2026-03-09T00:00:00.000Z",
      end: "2026-03-16T00:00:00.000Z",
    });
  });

  it("resolves gecen hafta ASCII", () => {
    expectRange("gecen hafta", {
      start: "2026-03-09T00:00:00.000Z",
      end: "2026-03-16T00:00:00.000Z",
    });
  });

  it("resolves next week", () => {
    expectRange("next week", {
      start: "2026-03-23T00:00:00.000Z",
      end: "2026-03-30T00:00:00.000Z",
    });
  });

  it("resolves this month", () => {
    expectRange("this month", {
      start: "2026-03-01T00:00:00.000Z",
      end: "2026-04-01T00:00:00.000Z",
    });
  });

  it("resolves gecen ay", () => {
    expectRange("ge\u00e7en ay", {
      start: "2026-02-01T00:00:00.000Z",
      end: "2026-03-01T00:00:00.000Z",
    });
  });

  it("resolves this year", () => {
    expectRange("this year", {
      start: "2026-01-01T00:00:00.000Z",
      end: "2027-01-01T00:00:00.000Z",
    });
  });

  it("resolves gecen yil", () => {
    expectRange("ge\u00e7en y\u0131l", {
      start: "2025-01-01T00:00:00.000Z",
      end: "2026-01-01T00:00:00.000Z",
    });
  });

  it("resolves 3 days ago", () => {
    expectRange("3 days ago", {
      start: "2026-03-16T00:00:00.000Z",
      end: "2026-03-17T00:00:00.000Z",
    });
  });

  it("resolves 3 gun once", () => {
    expectRange("3 g\u00fcn \u00f6nce", {
      start: "2026-03-16T00:00:00.000Z",
      end: "2026-03-17T00:00:00.000Z",
    });
  });

  it("resolves 5 hours ago", () => {
    expectRange("5 hours ago", {
      start: "2026-03-19T07:00:00.000Z",
      end: "2026-03-19T08:00:00.000Z",
      confidence: "approximate",
    });
  });

  it("resolves 5 saat once", () => {
    expectRange("5 saat \u00f6nce", {
      start: "2026-03-19T07:00:00.000Z",
      end: "2026-03-19T08:00:00.000Z",
      confidence: "approximate",
    });
  });

  it("resolves 2 weeks ago to a whole week window", () => {
    expectRange("2 weeks ago", {
      start: "2026-03-02T00:00:00.000Z",
      end: "2026-03-09T00:00:00.000Z",
    });
  });

  it("resolves last Tuesday", () => {
    expectRange("last Tuesday", {
      start: "2026-03-10T00:00:00.000Z",
      end: "2026-03-11T00:00:00.000Z",
    });
  });

  it("resolves gecen Sali", () => {
    expectRange("ge\u00e7en Sal\u0131", {
      start: "2026-03-10T00:00:00.000Z",
      end: "2026-03-11T00:00:00.000Z",
    });
  });

  it("resolves this Tuesday", () => {
    expectRange("this Tuesday", {
      start: "2026-03-17T00:00:00.000Z",
      end: "2026-03-18T00:00:00.000Z",
    });
  });

  it("resolves bu sali", () => {
    expectRange("bu sal\u0131", {
      start: "2026-03-17T00:00:00.000Z",
      end: "2026-03-18T00:00:00.000Z",
    });
  });

  it("resolves next Monday", () => {
    expectRange("next Monday", {
      start: "2026-03-23T00:00:00.000Z",
      end: "2026-03-24T00:00:00.000Z",
    });
  });

  it("resolves gelecek pazartesi", () => {
    expectRange("gelecek pazartesi", {
      start: "2026-03-23T00:00:00.000Z",
      end: "2026-03-24T00:00:00.000Z",
    });
  });

  it("resolves ISO date", () => {
    expectRange("2026-03-12", {
      start: "2026-03-12T00:00:00.000Z",
      end: "2026-03-13T00:00:00.000Z",
    });
  });

  it("resolves dotted numeric date", () => {
    expectRange("12.03.2026", {
      start: "2026-03-12T00:00:00.000Z",
      end: "2026-03-13T00:00:00.000Z",
    });
  });

  it("resolves slashed numeric date", () => {
    expectRange("12/03/2026", {
      start: "2026-03-12T00:00:00.000Z",
      end: "2026-03-13T00:00:00.000Z",
    });
  });

  it("resolves day month year in English", () => {
    expectRange("12 March 2026", {
      start: "2026-03-12T00:00:00.000Z",
      end: "2026-03-13T00:00:00.000Z",
    });
  });

  it("resolves month day, year in English", () => {
    expectRange("March 12, 2026", {
      start: "2026-03-12T00:00:00.000Z",
      end: "2026-03-13T00:00:00.000Z",
    });
  });

  it("resolves Turkish named month", () => {
    expectRange("12 Mart 2026", {
      start: "2026-03-12T00:00:00.000Z",
      end: "2026-03-13T00:00:00.000Z",
    });
  });

  it("resolves Turkish named month with accent", () => {
    expectRange("12 A\u011fustos 2025", {
      start: "2025-08-12T00:00:00.000Z",
      end: "2025-08-13T00:00:00.000Z",
    });
  });

  it("defaults missing year to the current local year", () => {
    expectRange("12 mart", {
      start: "2026-03-12T00:00:00.000Z",
      end: "2026-03-13T00:00:00.000Z",
      confidence: "approximate",
    });
  });

  it("extracts expressions from longer Turkish text", () => {
    expectRange("ge\u00e7en hafta sporda dinledi\u011fim podcast neydi?", {
      start: "2026-03-09T00:00:00.000Z",
      end: "2026-03-16T00:00:00.000Z",
      rawExpression: "ge\u00e7en hafta",
    });
  });

  it("extracts expressions from longer English text", () => {
    expectRange("what did we decide last Tuesday about the launch?", {
      start: "2026-03-10T00:00:00.000Z",
      end: "2026-03-11T00:00:00.000Z",
      rawExpression: "last Tuesday",
    });
  });

  it("applies UTC+3 to yesterday", () => {
    expectRange("yesterday UTC+3", {
      start: "2026-03-17T21:00:00.000Z",
      end: "2026-03-18T21:00:00.000Z",
    });
  });

  it("applies GMT+9 to today", () => {
    expectRange("today GMT+9", {
      start: "2026-03-18T15:00:00.000Z",
      end: "2026-03-19T15:00:00.000Z",
    });
  });

  it("applies TSI to dun", () => {
    expectRange("d\u00fcn TSI", {
      start: "2026-03-17T21:00:00.000Z",
      end: "2026-03-18T21:00:00.000Z",
    });
  });

  it("applies UTC+5:30 to last Tuesday", () => {
    expectRange("last Tuesday UTC+5:30", {
      start: "2026-03-09T18:30:00.000Z",
      end: "2026-03-10T18:30:00.000Z",
    });
  });

  it("applies UTC-4 to an absolute ISO date", () => {
    expectRange("2026-03-12 UTC-4", {
      start: "2026-03-12T04:00:00.000Z",
      end: "2026-03-13T04:00:00.000Z",
    });
  });

  it("respects the default UTC offset when no timezone is present", () => {
    expectRange(
      "today",
      {
        start: "2026-03-18T21:00:00.000Z",
        end: "2026-03-19T21:00:00.000Z",
      },
      { defaultUtcOffsetMinutes: 180 },
    );
  });

  it("returns null for unrecognized expressions", () => {
    expect(resolveTemporalRange("bana uygun bir zaman bul", { now: NOW })).toBeNull();
  });

  it("returns null for invalid absolute dates", () => {
    expect(resolveTemporalRange("2026-02-31", { now: NOW })).toBeNull();
  });

  it("returns null for empty strings", () => {
    expect(resolveTemporalRange("   ", { now: NOW })).toBeNull();
  });
});
