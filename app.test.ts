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
