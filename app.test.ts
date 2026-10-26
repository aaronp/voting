// Runs the app's logic class (Tally.dc.html) with the browser stubbed out and the real ledger.js behind it.
import { test, expect } from "bun:test";
import { join } from "node:path";
import * as L from "./ledger.js";

const html = await Bun.file(join(import.meta.dir, "Tally.dc.html")).text();
const js = html.split("<script type=\"text/x-dc\" data-dc-script")[1].split(">").slice(1).join(">").split("</script>")[0];
// Like React: state merges, then componentDidUpdate.
class DCLogic { state: any; props: any; constructor(p: any) { this.props = p ?? {}; }
  setState(u: any) { this.state = { ...this.state, ...(typeof u === "function" ? u(this.state) : u) }; (this as any).componentDidUpdate?.(); } }

function load(search = "", store: Record<string, string> = {}, fetch?: (u: string) => Response) {
  const pushed: string[] = [];
  const g: any = {
    location: { search, href: "https://x.test/app/" + search, pathname: "/app/", hash: "" },
    localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => (store[k] = v) },
    history: {
      replaceState: (_s: any, _t: string, u: string) => (g.location.search = u.split("?")[1] ? "?" + u.split("?")[1] : ""),
      pushState: (_s: any, _t: string, u: string) => { pushed.push(u); g.location.search = u.split("?")[1] ? "?" + u.split("?")[1] : ""; },
    },
    window: { addEventListener() {}, removeEventListener() {}, scrollTo() {}, setTimeout, TallyLedger: L },
    fetch: async (u: string) => fetch!(u), document: { getElementById: () => null, documentElement: { dataset: {} } }, setTimeout, clearTimeout,
  };
  const C = new Function("DCLogic", ...Object.keys(g), js + "\nreturn Component;")(DCLogic, ...Object.values(g));
  return { C, store, g, pushed };
}
const mount = (search = "", store: Record<string, string> = {}, fetch?: (u: string) => Response) => {
  const env = load(search, store, fetch); const app = new env.C({}); app.componentDidMount(); return { app, ...env };
};

// A minted Yes/No poll for alice (4) and bob (8), and one draft. keys holds every secret; pollId is the mint's SAID.
export function fixture(title = "Lunch?") {
  const org = L.newKeypair(), alice = L.newKeypair(), bob = L.newKeypair();
  const mint = L.makeMint({ title, desc: "", options: ["Yes", "No"], quadratic: false, organiser: { id: "Organiser", keys: [org.pub] },
    subjects: [{ id: "alice", keys: [alice.pub], weight: 4 }, { id: "bob", keys: [bob.pub], weight: 8 }], dt: "2026-10-26T00:00:00.000Z" }, org.secret);
  const doc = { polls: [[mint]] as any[][], drafts: [{ id: "d1", title: "Next?", desc: "", options: ["A", "B"], quadratic: false, organiser: "Organiser", subjects: [] }] };
  return { doc, keys: { org, alice, bob }, pollId: mint.d };
}
const keyring = (...ks: { pub: string, secret: string }[]) => JSON.stringify(Object.fromEntries(ks.map(k => [k.pub, k.secret])));

test("a fresh start is empty", () => {
  expect(mount().app.state.doc).toEqual({ polls: [], drafts: [] });
});

test("the saved v2 doc loads; v1 is ignored", () => {
  expect(mount("", { "tally:json:v1": JSON.stringify({ voters: [], polls: [] }) }).app.state.doc).toEqual({ polls: [], drafts: [] });
  const { doc } = fixture();
  expect(mount("", { "tally:json:v2": L.serializeFile(doc) }).app.state.doc).toEqual(doc);
});

test("?src= loads without saving; opening a file saves it and drops ?src=", async () => {
  const store: Record<string, string> = {}, file = L.serializeFile(fixture("Club").doc);
  const { app, g } = mount("?src=club.json", store, (u) => { expect(u).toBe("https://x.test/app/club.json"); return new Response(file); });
  await Bun.sleep(0);
  expect(app.state.doc.polls[0][0].title).toBe("Club");
  expect(store["tally:json:v2"]).toBeUndefined();
  app.adopt(L.serializeFile(fixture("Club 2").doc), "club.json");
  expect(g.location.search).toBe("");
  expect(JSON.parse(store["tally:json:v2"]).polls[0][0].title).toBe("Club 2");
});

test("the address bar drives navigation: pages push, filters replace, other params are kept", () => {
  const { app, g, pushed } = mount("?src=x.json&poll=Eabc&tab=ledger&layout=radial&theme=night", {}, () => new Response("{}", { status: 404 }));
  expect(app.state).toMatchObject({ view: "poll", pollId: "Eabc", tab: "ledger", theme: "night" });
  expect(g.location.search).toBe("?src=x.json&poll=Eabc&tab=ledger&theme=night");
  app.setState({ q: "nope" });
  expect(g.location.search).toBe("?src=x.json&poll=Eabc&tab=ledger&theme=night");
  app.setState({ view: "dashboard" });
  app.setState({ filter: "drafts", q: "solar" });
  expect(g.location.search).toBe("?src=x.json&filter=drafts&q=solar&theme=night");
  expect(pushed).toEqual(["/app/?src=x.json&q=nope&theme=night"]);
  g.location.search = "?edit=d1"; app._onPop();
  expect(app.state).toMatchObject({ view: "editor", editId: "d1", filter: "all", q: "" });
});

test("dashboard rows come from chains", () => {
  const good = fixture("Good"), bad = fixture("Bad");
  bad.doc.polls[0][0].total = 13;
  const doc = { polls: [good.doc.polls[0], bad.doc.polls[0]], drafts: good.doc.drafts };
  const rows = mount("", { "tally:json:v2": L.serializeFile(doc) }).app.renderVals().rows;
  const row = (t: string) => rows.find((r: any) => r.title === t);
  expect(row("Good")).toMatchObject({ status: "Live" }); expect(row("Good").chips).toContain("Verified");
  expect(row("Good").meta).toBe("0 of 2 subjects voted · 0/12 weight");
  expect(row("Bad").chips).toContain("Broken");
  expect(row("Next?")).toMatchObject({ status: "Draft" });
});

test("filters use the keys this browser holds", () => {
  const { doc, keys } = fixture();
  const app = mount("", { "tally:json:v2": L.serializeFile(doc), "tally:keys:v1": keyring(keys.alice) }).app;
  app.setState({ filter: "todo" }); expect(app.renderVals().rows.map((r: any) => r.title)).toEqual(["Lunch?"]);
  app.setState({ filter: "voted" }); expect(app.renderVals().rows).toEqual([]);
  app.setState({ filter: "drafts" }); expect(app.renderVals().rows.map((r: any) => r.title)).toEqual(["Next?"]);
});

const withDraft = (store: Record<string, string> = {}) => { const env = mount("", store); const id = env.app.newDraft(); return { ...env, id }; };
const fill = (app: any, id: string, d: any) => app.setDraft(id, (x: any) => ({ ...x, ...d }));
const READY = { title: "Lunch?", options: ["Yes", "No"], subjects: [{ id: "alice", keys: [], weight: 4 }, { id: "bob", keys: [], weight: 8 }] };

test("a new draft is saved in the file", () => {
  const { app, id, store } = withDraft();
  expect(app.state.view).toBe("editor");
  expect(app.state.doc.drafts[0]).toMatchObject({ id, title: "", options: ["", ""], subjects: [{ id: "", keys: [], weight: 1 }] });
  expect(L.parseFile(store["tally:json:v2"]).drafts[0].id).toBe(id);
});

test("minting turns the draft into a verified chain", () => {
  const { app, id, store } = withDraft();
  fill(app, id, READY);
  const pollId = app.mintDraft(id);
  expect(app.state.doc.drafts).toEqual([]);
  const chain = app.state.doc.polls[0];
  expect(chain).toHaveLength(1); expect(chain[0].d).toBe(pollId);
  expect(L.verify(chain)).toMatchObject({ ok: true, total: 12 });
  expect(chain[0].subjects.every((s: any) => s.keys.length === 1 && s.keys[0].startsWith("D"))).toBe(true);
  const ring = JSON.parse(store["tally:keys:v1"]);
  for (const k of [...chain[0].organiser.keys, ...chain[0].subjects.flatMap((s: any) => s.keys)]) expect(ring[k]).toBeTruthy();
  for (const secret of Object.values(ring) as string[]) expect(store["tally:json:v2"]).not.toContain(secret);
  expect(app.state).toMatchObject({ view: "poll", pollId });
});

test("minting is refused when the draft is incomplete", () => {
  const cases: [any, RegExp][] = [
    [{ title: " " }, /title/], [{ options: ["Yes", " "] }, /two options/], [{ subjects: [] }, /subject/],
    [{ subjects: [{ id: " ", keys: [], weight: 1 }] }, /id/], [{ subjects: [{ id: "a", keys: [], weight: 1 }, { id: "a", keys: [], weight: 2 }] }, /"a" is listed twice/],
    [{ subjects: [{ id: "a", keys: [], weight: 0 }] }, /at least 1/],
  ];
  for (const [change, msg] of cases) {
    const { app, id } = withDraft();
    fill(app, id, { ...READY, ...change });
    expect(app.mintDraft(id)).toBeNull();
    expect(app.state.toast).toMatch(msg);
    expect(app.state.doc.polls).toEqual([]);
  }
});

test("pasted keys are kept", () => {
  const pasted = L.newKeypair();
  const { app, id, store } = withDraft();
  fill(app, id, { ...READY, subjects: [{ id: "alice", keys: [pasted.pub], weight: 4 }] });
  app.mintDraft(id);
  expect(app.state.doc.polls[0][0].subjects[0].keys).toEqual([pasted.pub]);
  expect(JSON.parse(store["tally:keys:v1"])[pasted.pub]).toBeUndefined();
  const bad = withDraft();
  fill(bad.app, bad.id, { ...READY, subjects: [{ id: "alice", keys: ["not-a-key"], weight: 4 }] });
  expect(bad.app.mintDraft(bad.id)).toBeNull();
  expect(bad.app.state.toast).toMatch(/alice/);
});

const pollApp = (f: any, ...held: any[]) => {
  const env = mount("", { "tally:json:v2": L.serializeFile(f.doc), ...(held.length ? { "tally:keys:v1": keyring(...held) } : {}) });
  env.app.openPoll(f.pollId); return env;
};
const chainOf = (app: any) => app.state.doc.polls[0];

test("a subject can vote once", () => {
  const f = fixture(), { app } = pollApp(f, f.keys.alice, f.keys.bob);
  expect(app.renderVals().pv.voters.map((v: any) => v.id)).toEqual(["alice", "bob"]);
  app.setState({ voteAs: "alice", allocs: { [f.pollId]: { 0: 3 } } });
  app.renderVals().pv.cast();
  expect(chainOf(app)).toHaveLength(2);
  expect(L.verify(chainOf(app))).toMatchObject({ ok: true, totals: [3, 0] });
  app.castAs(f.pollId, "alice", { 0: 1 }); app.castAs(f.pollId, "alice", { 0: 1 });
  expect(chainOf(app)).toHaveLength(2);
  expect(app.renderVals().pv.voters.map((v: any) => v.id)).toEqual(["bob"]);
});

test("allocations are limited by weight", () => {
  const f = fixture(), { app } = pollApp(f, f.keys.alice);
  app.setState({ voteAs: "alice", allocs: { [f.pollId]: { 0: 4 } } });
  expect(app.renderVals().pv.options[0].canUp).toBe(false);
  const org = L.newKeypair(), a = L.newKeypair();
  const mint = L.makeMint({ title: "Q", desc: "", options: ["A", "B"], quadratic: true, organiser: { id: "o", keys: [org.pub] }, subjects: [{ id: "alice", keys: [a.pub], weight: 9 }], dt: "t" }, org.secret);
  const q = pollApp({ doc: { polls: [[mint]], drafts: [] }, pollId: mint.d }, a).app;
  q.setState({ voteAs: "alice", allocs: { [mint.d]: { 0: 1 } } });
  expect(q.renderVals().pv.options[0].next).toBe(3);
  q.setState({ allocs: { [mint.d]: { 0: 3 } } });
  expect(q.renderVals().pv.options[1].canUp).toBe(false);
});

test("without keys the vote tab is read-only", () => {
  const pv = pollApp(fixture()).app.renderVals().pv;
  expect(pv.voters).toEqual([]);
  expect(pv.noKeys).toBe(true); expect(pv.noKeysText).toBe("This browser holds none of this poll's keys.");
  expect(pv.canCast).toBe(false);
});

test("results come from the verdict", () => {
  const f = fixture(), c = f.doc.polls[0];
  c.push(L.makeVote(c, { subject: "alice", alloc: { 0: 3 }, key: f.keys.alice.pub, dt: "t" }, f.keys.alice.secret));
  c.push(L.makeVote(c, { subject: "bob", alloc: { 1: 8 }, key: f.keys.bob.pub, dt: "t" }, f.keys.bob.secret));
  const pv = pollApp(f).app.renderVals().pv;
  expect(pv.results.map((r: any) => [r.label, r.total])).toEqual([["Yes", 3], ["No", 8]]);
  expect(pv.usedText).toBe("11 of 12 weight used");
});

test("the organiser can close", () => {
  const f = fixture();
  expect(pollApp(f, f.keys.alice).app.renderVals().pv.canClose).toBe(false);
  const { app } = pollApp(f, f.keys.org, f.keys.alice);
  app.renderVals().pv.close();
  expect(L.verify(chainOf(app))).toMatchObject({ ok: true, status: "closed" });
  const pv = app.renderVals().pv;
  expect(pv.status).toBe("Closed"); expect(pv.canClose).toBe(false); expect(pv.canCast).toBe(false); expect(pv.voters).toEqual([]);
});
