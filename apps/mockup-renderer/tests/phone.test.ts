import { describe, it, expect } from "vitest";
import { normalizePhone } from "../lib/phone";

describe("normalizePhone", () => {
  it("normalizes 10-digit US numbers", () => {
    expect(normalizePhone("(516) 555-1212")).toBe("+15165551212");
  });

  it("preserves leading country code", () => {
    expect(normalizePhone("1-516-555-1212")).toBe("+15165551212");
  });

  it("returns null for empty input", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});
