// The signed ledger (ledger.js): encoding, hashing, signing, entries, verification and the file format.
import { test, expect } from "bun:test";
import * as L from "./ledger.js";

test("CESR round-trips and has the right lengths", () => {
  const raw = new Uint8Array(32).fill(7), sig = new Uint8Array(64).fill(9);
  expect(L.cesrEncode("E", raw)).toHaveLength(44); expect(L.cesrEncode("E", raw)[0]).toBe("E");
  expect(L.cesrEncode("0B", sig)).toHaveLength(88); expect(L.cesrEncode("0B", sig).slice(0, 2)).toBe("0B");
  expect(L.cesrDecode(L.cesrEncode("D", raw))).toEqual({ code: "D", raw });
});

test("canonical form ignores field order", () => {
  const a = { v: "tally/1", t: "close", d: "x", p: "y", dt: "2026-10-26T00:00:00.000Z", sig: "s" };
  const b = { sig: "s", dt: a.dt, p: "y", d: "x", t: "close", v: "tally/1" };
  expect(L.canonical(a)).toBe(L.canonical(b)); expect(L.canonical(a)).not.toContain("sig");
  expect(L.said(a)).toBe(L.said(b)); expect(L.said(a)).toMatch(/^E[A-Za-z0-9_-]{43}$/);
});

test("SAID ignores the current d and changes with content", () => {
  const e = { v: "tally/1", t: "close", d: "", p: "y", dt: "t" };
  expect(L.said({ ...e, d: L.said(e) })).toBe(L.said(e));
  expect(L.said({ ...e, p: "z" })).not.toBe(L.said(e));
});

test("signatures verify only for the signed entry and key", () => {
  const k = L.newKeypair(), other = L.newKeypair();
  const e: any = { v: "tally/1", t: "close", d: "", p: "y", dt: "t" }; e.d = L.said(e);
  const sig = L.sign(e, k.secret);
  expect(sig).toMatch(/^0B/); expect(L.verifySig(e, k.pub, sig)).toBe(true);
  expect(L.verifySig({ ...e, p: "z" }, k.pub, sig)).toBe(false);
  expect(L.verifySig(e, other.pub, sig)).toBe(false);
  expect(L.verifySig(e, "Dnot-a-key", "0Bnope")).toBe(false);
});
