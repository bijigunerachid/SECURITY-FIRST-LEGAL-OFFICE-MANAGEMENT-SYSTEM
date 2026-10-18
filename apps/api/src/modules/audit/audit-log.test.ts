import { describe, expect, it } from "vitest";
import { canonicalJson } from "./audit-log.js";

describe("canonicalJson", () => {
  it("sorts keys at every level, so jsonb key reordering cannot change a hash", () => {
    const a = canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } });
    const b = canonicalJson({ a: { c: null, d: [1, { y: 2, z: 1 }] }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":null,"d":[1,{"y":2,"z":1}]},"b":1}');
  });

  it("drops undefined values like JSON does", () => {
    expect(canonicalJson({ a: undefined, b: 2 })).toBe('{"b":2}');
  });
});
