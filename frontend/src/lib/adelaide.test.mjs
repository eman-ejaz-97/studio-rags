import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  currentMonth,
  dayKey,
  formatDay,
  formatMonth,
  formatTime,
  monthRange,
  parseMonth,
  shiftMonth,
} from "./adelaide.ts";

describe("Adelaide dates", () => {
  // 23:30 UTC on Friday is 10:00 on Saturday in Adelaide (UTC+10:30 in summer).
  const saturdayMorning = "2026-11-13T23:30:00.000Z";

  it("shows the Adelaide day and time, not the server's", () => {
    assert.equal(formatDay(saturdayMorning), "Sat 14 Nov");
    assert.equal(formatTime(saturdayMorning), "10:00 am");
    assert.equal(dayKey(saturdayMorning), "2026-11-14");
  });

  it("bounds a summer month at Adelaide midnight (UTC+10:30)", () => {
    assert.deepEqual(monthRange("2026-12"), {
      from: "2026-11-30T13:30:00.000Z",
      to: "2026-12-31T13:30:00.000Z",
    });
  });

  it("bounds a month that crosses daylight saving on both offsets", () => {
    // 1 April is still summer time (+10:30); 1 May is winter (+9:30).
    assert.deepEqual(monthRange("2027-04"), {
      from: "2027-03-31T13:30:00.000Z",
      to: "2027-04-30T14:30:00.000Z",
    });
  });

  it("knows which month it is in Adelaide when UTC is still on the last day", () => {
    // 31 Oct 14:00 UTC is 1 Nov 00:30 in Adelaide.
    assert.equal(currentMonth(new Date("2026-10-31T14:00:00.000Z")), "2026-11");
  });

  it("steps across year ends", () => {
    assert.equal(shiftMonth("2026-12", 1), "2027-01");
    assert.equal(shiftMonth("2027-01", -1), "2026-12");
  });

  it("names a month", () => {
    assert.equal(formatMonth("2026-11"), "November 2026");
  });

  it("accepts only YYYY-MM", () => {
    assert.equal(parseMonth("2026-11"), "2026-11");
    for (const bad of [undefined, "", "2026-13", "2026-1", "nov", "2026-11-01"]) {
      assert.equal(parseMonth(bad), null, String(bad));
    }
  });
});
