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

// alice (weight 4) and bob (weight 8) on a Yes/No poll; keys holds every secret.
function demo(quadratic = false) {
  const org = L.newKeypair(), a = L.newKeypair(), b = L.newKeypair();
  const mint = L.makeMint({ title: "Lunch?", desc: "", options: ["Yes", "No"], quadratic, organiser: { id: "org", keys: [org.pub] },
    subjects: [{ id: "alice", keys: [a.pub], weight: 4 }, { id: "bob", keys: [b.pub], weight: 8 }], dt: "2026-10-26T00:00:00.000Z" }, org.secret);
  return { chain: [mint] as any[], keys: { org, alice: a, bob: b } };
}
const voteAs = (chain: any[], keys: any, subject: string, alloc: any, signer = subject) =>
  L.makeVote(chain, { subject, alloc, key: keys[subject]?.pub ?? keys.alice.pub, dt: "2026-10-26T01:00:00.000Z" }, keys[signer]?.secret ?? keys.alice.secret);
const rules = (chain: any[]) => L.verify(chain).failures.map((f: any) => f.rule);

test("a fresh mint verifies", () => {
  expect(L.verify(demo().chain)).toMatchObject({ ok: true, status: "live", total: 12, used: 0, totals: [0, 0], failures: [] });
});

test("votes add up", () => {
  const { chain, keys } = demo();
  chain.push(voteAs(chain, keys, "alice", { 0: 3 }));
  chain.push(voteAs(chain, keys, "bob", { 1: 8 }));
  expect(L.verify(chain)).toMatchObject({ ok: true, totals: [3, 8], used: 11, voted: { alice: 1, bob: 2 } });
});

test("quadratic cost is the sum of squares", () => {
  expect(L.cost({ 0: 2, 1: 1 }, true)).toBe(5); expect(L.cost({ 0: 2, 1: 1 }, false)).toBe(3);
  const { chain, keys } = demo(true);
  chain.push(voteAs(chain, keys, "alice", { 0: 3 }));
  expect(rules(chain)).toEqual(["cost"]);
});

test("each rule reports", () => {
  const one = (build: (chain: any[], keys: any) => void) => { const { chain, keys } = demo(); build(chain, keys); return rules(chain); };
  expect(one((c, k) => { c[0] = voteAs(c, k, "alice", { 0: 1 }); })).toEqual(["first"]);
  expect(one((c, k) => { const v = voteAs(c, k, "alice", { 0: 1 }); v.p = L.said({ ...v, t: "close" }); v.d = L.said(v); v.sig = L.sign(v, k.alice.secret); c.push(v); })).toEqual(["link"]);
  expect(one((c, k) => { c[0].sig = L.sign(c[0], k.alice.secret); })).toEqual(["mint-sig"]);
  expect(one((c, k) => { c[0].total = 13; c[0].d = L.said(c[0]); c[0].sig = L.sign(c[0], k.org.secret); })).toEqual(["total"]);
  expect(one((c, k) => { c.push(L.makeVote(c, { subject: "carol", alloc: { 0: 1 }, key: k.alice.pub, dt: "t" }, k.alice.secret)); })).toEqual(["subject"]);
  expect(one((c, k) => { c.push(voteAs(c, k, "alice", { 0: 1 }, "bob")); })).toEqual(["vote-sig"]);
  expect(one((c, k) => { c.push(voteAs(c, k, "alice", { 0: 1 })); c.push(voteAs(c, k, "alice", { 1: 1 })); })).toEqual(["double"]);
  expect(one((c, k) => { c.push(voteAs(c, k, "alice", { 5: 1 })); })).toEqual(["options"]);
  expect(one((c, k) => { c.push(voteAs(c, k, "alice", { 0: 5 })); })).toEqual(["cost"]);
  expect(one((c, k) => { c.push(voteAs(c, k, "alice", {})); })).toEqual(["cost"]);
  expect(one((c, k) => { c.push(L.makeClose(c, "t", k.org.secret)); c.push(voteAs(c, k, "alice", { 0: 1 })); })).toEqual(["close"]);
});

test("a tampered vote is reported and later entries are still checked", () => {
  const { chain, keys } = demo();
  chain.push(voteAs(chain, keys, "alice", { 0: 3 }));
  chain.push(voteAs(chain, keys, "bob", { 1: 8 }));
  chain[1].alloc = { 1: 4 };
  const v = L.verify(chain);
  expect(v.ok).toBe(false);
  expect(v.failures.map((f: any) => [f.index, f.rule])).toEqual([[1, "said"], [1, "vote-sig"]]);
  expect(v.totals).toEqual([0, 8]);
  expect(v.failures[0].message).toBeTruthy();
});

test("close ends the poll", () => {
  const { chain, keys } = demo();
  chain.push(L.makeClose(chain, "2026-10-27T00:00:00.000Z", keys.org.secret));
  expect(L.verify(chain)).toMatchObject({ ok: true, status: "closed" });
});

const sampleDoc = () => {
  const { chain, keys } = demo();
  chain.push(voteAs(chain, keys, "alice", { 0: 3 }));
  chain.push(L.makeClose(chain, "2026-10-27T00:00:00.000Z", keys.org.secret));
  return { polls: [chain], drafts: [{ id: "d1", title: "Next?", desc: "", options: ["A", "B"], quadratic: false, organiser: "Organiser", subjects: [{ id: "x", keys: [], weight: 2 }] }] };
};

test("a file round-trips", () => {
  const text = L.serializeFile(sampleDoc());
  expect(L.serializeFile(L.parseFile(text))).toBe(text);
  expect(text.endsWith("\n")).toBe(true);
  expect(L.verify(L.parseFile(text).polls[0]).ok).toBe(true);
});

test("shapes are checked with paths", () => {
  const bad = (mutate: (d: any) => void) => () => { const d = JSON.parse(L.serializeFile(sampleDoc())); mutate(d); L.parseFile(JSON.stringify(d)); };
  expect(() => L.parseFile("{")).toThrow(/Not valid JSON/);
  expect(bad(d => { delete d.polls; })).toThrow("polls: expected a list");
  expect(bad(d => { d.polls[0][0].t = "ballot"; })).toThrow("polls[0][0].t");
  for (const w of [0, -1, 1.5, "4"]) expect(bad(d => { d.polls[0][0].subjects[0].weight = w; })).toThrow("polls[0][0].subjects[0].weight");
  expect(bad(d => { d.polls[0][1].alloc["0"] = -1; })).toThrow("polls[0][1].alloc.0");
  expect(bad(d => { d.polls[0][1].extra = 1; })).toThrow("polls[0][1].extra: unknown field");
  expect(bad(d => { delete d.drafts[0].title; })).toThrow("drafts[0].title");
  expect(bad(d => { d.polls[0][0].subjects[1].id = "alice"; })).toThrow('polls[0][0].subjects[1].id: duplicate subject "alice"');
});

test("the old format is not read", () => {
  const old = { title: "Club", voters: [{ name: "Me" }], polls: [{ id: "q", status: "live", title: "Lunch?", options: ["Yes", "No"], ballots: [] }] };
  expect(() => L.parseFile(JSON.stringify(old))).toThrow(/^polls\[0\]/);
});

test("a well-formed file that fails verification still parses", () => {
  const d = sampleDoc(); d.polls[0][0].total = 13;
  const doc = L.parseFile(L.serializeFile(d));
  expect(L.verify(doc.polls[0]).failures.map((f: any) => f.rule)).toContain("total");
});

test("drafts may be empty or incomplete", () => {
  const doc = L.parseFile(JSON.stringify({ polls: [], drafts: [{ id: "d2", title: "" }] }));
  expect(doc.drafts[0]).toEqual({ id: "d2", title: "", desc: "", options: [], quadratic: false, organiser: "Organiser", subjects: [] });
  expect(L.parseFile('{ "polls": [] }')).toEqual({ polls: [], drafts: [] });
});

test("drafts may have blank or repeated subject ids while being edited", () => {
  const draft = { id: "d", title: "x", subjects: [{ id: "", keys: [], weight: 0 }, { id: "a" }, { id: "a" }] };
  expect(L.parseFile(JSON.stringify({ polls: [], drafts: [draft] })).drafts[0].subjects).toHaveLength(3);
});

test("the example verifies, and schema.md's example parses and verifies", async () => {
  const doc = L.parseFile(await Bun.file(import.meta.dir + "/examples/harbor-commons/tally.json").text());
  expect(doc.polls.length).toBeGreaterThanOrEqual(2);
  const verdicts = doc.polls.map((c: any) => L.verify(c));
  expect(verdicts.every((v: any) => v.ok)).toBe(true);
  expect(verdicts.some((v: any) => v.status === "closed")).toBe(true);
  const schema = await Bun.file(import.meta.dir + "/schema.md").text();
  const small = L.parseFile(schema.split("```json\n")[1].split("```")[0]);
  expect(small.polls.every((c: any) => L.verify(c).ok)).toBe(true);
});

test("final review: a repeated poll id is rejected", () => {
  const d = sampleDoc(), text = L.serializeFile({ polls: [d.polls[0], d.polls[0]], drafts: [] });
  expect(() => L.parseFile(text)).toThrow("polls[1][0].d: duplicate poll");
});

test("final review: option keys must be plain option numbers", () => {
  for (const o of ["-1", "", "01", "1.0", " 1"]) {
    const { chain, keys } = demo();
    chain.push(voteAs(chain, keys, "alice", { [o]: 1 }));
    expect(rules(chain)).toContain("options");
  }
});

test("final review: a mint needs subjects, and every subject a key", () => {
  const bad = (mutate: (d: any) => void) => () => { const d = JSON.parse(L.serializeFile(sampleDoc())); mutate(d); L.parseFile(JSON.stringify(d)); };
  expect(bad(d => { d.polls[0][0].subjects[0].keys = []; })).toThrow("polls[0][0].subjects[0].keys: needs at least one");
  expect(bad(d => { d.polls[0][0].subjects = []; })).toThrow("polls[0][0].subjects: needs at least one");
});

test("merkle groups and rolls up", () => {
  const leaves = Array.from({ length: 5 }, (_, i) => L.said({ v: "tally/1", t: "close", d: "", p: String(i), dt: "t" }));
  expect(L.merkle(leaves, 2).map((l: string[]) => l.length)).toEqual([5, 3, 2, 1]);
  expect(L.merkle(leaves, 10).map((l: string[]) => l.length)).toEqual([5, 1]);
  expect(L.merkle(leaves.slice(0, 1), 10).map((l: string[]) => l.length)).toEqual([1, 1]);
  for (const level of L.merkle(leaves, 2).slice(1)) for (const n of level) expect(n).toMatch(/^E[A-Za-z0-9_-]{43}$/);
});

test("close records the signed root", () => {
  const { chain, keys } = demo();
  chain.push(voteAs(chain, keys, "alice", { 0: 1 }));
  const root = L.rootOf(chain), close = L.makeClose(chain, "t", keys.org.secret);
  expect(close).toMatchObject({ root, group: 10 });
  chain.push(close);
  expect(L.verify(chain).ok).toBe(true);
});

test("a wrong root fails rule root", () => {
  const { chain, keys } = demo();
  const c = L.makeClose(chain, "t", keys.org.secret);
  c.root = L.said({ v: "tally/1", t: "close", d: "", p: "x", dt: "t" }); c.d = L.said(c); c.sig = L.sign(c, keys.org.secret);
  chain.push(c);
  expect(rules(chain)).toEqual(["root"]);
});

test("old closes without a root still verify", () => {
  const { chain, keys } = demo();
  const c: any = L.makeClose(chain, "t", keys.org.secret);
  delete c.root; delete c.group; c.d = L.said(c); c.sig = L.sign(c, keys.org.secret);
  chain.push(c);
  expect(L.verify(chain).ok).toBe(true);
  expect(L.parseFile(L.serializeFile({ polls: [chain], drafts: [] })).polls[0][1]).not.toHaveProperty("root");
});

test("seals add up", () => {
  const r1 = L.randomBlind(), r2 = L.randomBlind();
  expect(L.addSeals([L.seal(3, r1), L.seal(4, r2)])).toBe(L.seal(7, (r1 + r2) % L.L_ORDER));
  expect(L.seal(0, 0n)).toBe(L.addSeals([]));
});

test("a seal hides nothing it shouldn't reveal", () => {
  const r = L.randomBlind();
  expect(L.seal(3, r)).not.toBe(L.seal(4, r));
  expect(L.seal(3, r)).not.toBe(L.seal(3, L.randomBlind()));
});

test("openings round-trip only for the right key", async () => {
  const k = L.newEncKeypair(), other = L.newEncKeypair();
  const payload = await L.encrypt(k.pub, "hi");
  expect(await L.decrypt(k.secret, payload)).toBe("hi");
  await expect(L.decrypt(other.secret, payload)).rejects.toThrow();
});

test("C keys are CESR", () => {
  expect(L.newEncKeypair().pub).toMatch(/^C[A-Za-z0-9_-]{43}$/);
});

// A sealed Yes/No poll for alice (4) and bob (8); keys.org.enc decrypts openings.
function sealedDemo(quadratic = false) {
  const org = L.newKeypair(), enc = L.newEncKeypair(), a = L.newKeypair(), b = L.newKeypair();
  const mint = L.makeMint({ title: "Sealed", desc: "", options: ["Yes", "No"], quadratic, kind: "sealed", organiser: { id: "org", keys: [org.pub], enc: enc.pub },
    subjects: [{ id: "alice", keys: [a.pub], weight: 4 }, { id: "bob", keys: [b.pub], weight: 8 }], dt: "t" }, org.secret);
  return { chain: [mint] as any[], keys: { org, enc, alice: a, bob: b } as any };
}
const sealedVote = async (chain: any[], keys: any, subject: string, alloc: any, viaChain = chain) =>
  (await L.makeSealedVote(viaChain, { subject, alloc, key: keys[subject].pub, dt: "t" }, keys[subject].secret)).entry;

test("sealed votes verify without revealing allocations", async () => {
  const { chain, keys } = sealedDemo();
  const { entry, opening } = await L.makeSealedVote(chain, { subject: "alice", alloc: { 0: 3 }, key: keys.alice.pub, dt: "t" }, keys.alice.secret);
  chain.push(entry); chain.push(await sealedVote(chain, keys, "bob", { 1: 8 }));
  expect(opening.values).toEqual([3, 0]);
  expect(entry.seals).toHaveLength(2);
  expect(L.verify(chain)).toMatchObject({ ok: true, totals: [0, 0], used: 0, sealed: true, status: "live" });
  const text = L.serializeFile({ polls: [chain], drafts: [] });
  expect(text).not.toContain('"alloc"'); expect(text).not.toContain(opening.blinds[0]);
  expect(L.parseFile(text).polls[0][1].seals).toEqual(entry.seals);
});

test("a tally publishes totals anyone can check", async () => {
  const { chain, keys } = sealedDemo();
  chain.push(await sealedVote(chain, keys, "alice", { 0: 3 }));
  chain.push(await sealedVote(chain, keys, "bob", { 1: 8 }));
  const tally = await L.makeTally(chain, { secret: keys.org.secret, encSecret: keys.enc.secret }, "t");
  expect(tally).toMatchObject({ t: "tally", totals: [3, 8], used: 11, excluded: [], group: 10, root: L.rootOf(chain) });
  chain.push(tally);
  expect(L.verify(chain)).toMatchObject({ ok: true, status: "closed", totals: [3, 8], used: 11 });
});

test("a wrong total fails rule tally", async () => {
  const { chain, keys } = sealedDemo();
  chain.push(await sealedVote(chain, keys, "alice", { 0: 3 }));
  const t = await L.makeTally(chain, { secret: keys.org.secret, encSecret: keys.enc.secret }, "t");
  t.totals[0] = 4; t.d = L.said(t); t.sig = L.sign(t, keys.org.secret);
  chain.push(t);
  expect(rules(chain)).toEqual(["tally"]);
});

test("the tally excludes ballots that don't open", async () => {
  const { chain, keys } = sealedDemo(true), other = L.newEncKeypair();
  chain.push(await sealedVote(chain, keys, "alice", { 0: 1 }, [{ ...chain[0], organiser: { ...chain[0].organiser, enc: other.pub } }]));
  chain.push(await sealedVote(chain, keys, "bob", { 1: 2 }));
  const quad = sealedDemo(true);
  quad.chain.push(await sealedVote(quad.chain, quad.keys, "alice", { 0: 3 }));
  const t1 = await L.makeTally(chain, { secret: keys.org.secret, encSecret: keys.enc.secret }, "t");
  expect(t1.excluded).toEqual([{ index: 1, reason: "does not open" }]); expect(t1.totals).toEqual([0, 2]);
  chain.push(t1); expect(L.verify(chain).ok).toBe(true);
  const t2 = await L.makeTally(quad.chain, { secret: quad.keys.org.secret, encSecret: quad.keys.enc.secret }, "t");
  expect(t2.excluded).toEqual([{ index: 1, reason: "costs 9, holds 4" }]); expect(t2.totals).toEqual([0, 0]);
  quad.chain.push(t2); expect(L.verify(quad.chain).ok).toBe(true);
});

test("a close is not allowed on a sealed poll", async () => {
  const { chain, keys } = sealedDemo();
  chain.push(L.makeClose(chain, "t", keys.org.secret));
  expect(rules(chain)).toContain("close");
});

test("open polls are unchanged", () => {
  const text = L.serializeFile(sampleDoc());
  expect(L.serializeFile(L.parseFile(text))).toBe(text);
  expect(L.verify(L.parseFile(text).polls[0])).toMatchObject({ ok: true, sealed: false });
});

test("the example has a tallied sealed poll and signed roots", async () => {
  const doc = L.parseFile(await Bun.file(import.meta.dir + "/examples/harbor-commons/tally.json").text());
  const sealed = doc.polls.filter((c: any) => c[0].kind === "sealed");
  expect(sealed.some((c: any) => c.at(-1).t === "tally" && L.verify(c).ok)).toBe(true);
  expect(sealed.some((c: any) => L.verify(c).status === "live")).toBe(true);
  for (const c of doc.polls) { expect(L.verify(c).ok).toBe(true); for (const e of c) if (e.t === "close" || e.t === "tally") expect(e.root).toBe(L.rootOf(c.slice(0, c.indexOf(e)))); }
  for (const c of sealed) for (const e of c) if (e.t === "vote") expect(e.alloc).toBeUndefined();
});
