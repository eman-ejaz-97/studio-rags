import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDuration, formatPrice, formatSeatsLeft } from "./format.ts";

describe("formatPrice", () => {
  it("drops cents when there are none", () => {
    assert.equal(formatPrice(8200), "$82");
    assert.equal(formatPrice(4200), "$42");
  });

  it("keeps both digits when there are", () => {
    assert.equal(formatPrice(8250), "$82.50");
    assert.equal(formatPrice(8205), "$82.05");
  });
});

describe("formatDuration", () => {
  it("speaks in whole hours when it can", () => {
    assert.equal(formatDuration(60), "1 hour");
    assert.equal(formatDuration(180), "3 hours");
  });

  it("uses minutes under two hours", () => {
    assert.equal(formatDuration(45), "45 minutes");
    assert.equal(formatDuration(90), "90 minutes");
  });

  it("spells out hours and minutes beyond that", () => {
    assert.equal(formatDuration(150), "2 hours 30 minutes");
  });
});

describe("formatSeatsLeft", () => {
  it("counts places in words a person would use", () => {
    assert.equal(formatSeatsLeft(1), "1 place left");
    assert.equal(formatSeatsLeft(5), "5 places left");
    assert.equal(formatSeatsLeft(0), "Fully booked");
  });
});
