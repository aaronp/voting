// Runs the app's logic class (Tally.dc.html) with the browser stubbed out.
import { test, expect } from "bun:test";
import { join } from "node:path";

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
    window: { addEventListener() {}, removeEventListener() {}, scrollTo() {}, setTimeout },
    fetch: async (u: string) => fetch!(u), document: { getElementById: () => null, documentElement: { dataset: {} } }, setTimeout, clearTimeout,
  };
  const C = new Function("DCLogic", ...Object.keys(g), js + "\nreturn Component;")(DCLogic, ...Object.values(g));
  return { C, store, g, pushed };
}
const EXAMPLE = await Bun.file(join(import.meta.dir, "examples/harbor-commons/tally.json")).text();
const mount = (search = "", store: Record<string, string> = {}, fetch?: (u: string) => Response) => {
  const env = load(search, store, fetch); const app = new env.C({}); app.componentDidMount(); return { app, ...env };
};

test("a fresh start has no polls", () => {
  const { app } = mount();
  expect(app.state.polls).toEqual([]);
  expect(app.voters.map((v: any) => v.name)).toEqual(["You"]);
});

test("the example round-trips through parse, load and serialize", async () => {
  const { app } = mount("", { "tally:json:v1": EXAMPLE });
  expect(app.serialize(app.parse(EXAMPLE))).toBe(EXAMPLE);
  expect(app.serialize(app.toDoc())).toBe(EXAMPLE);
  const schema = await Bun.file(join(import.meta.dir, "schema.md")).text();
  expect(app.parse(schema.split("```json\n")[1].split("```")[0]).polls[0].ballots).toHaveLength(1);
});

test("parse fills defaults and rejects bad files with the path", () => {
  const { app } = mount();
  const doc = app.parse(JSON.stringify({ voters: [{ name: "Me" }], polls: [{ id: "a", status: "live", title: "T", options: ["x", "y"], ballots: [{ voter: 0, alloc: { 1: 1 } }] }] }));
  expect(doc.polls[0]).toMatchObject({ desc: "", anonymous: false, quadratic: false, base: 1, rules: [], eligible: 1, ballots: [{ voter: 0, alloc: { 1: 1 } }] });
  const bad = (d: any) => () => app.parse(JSON.stringify(d));
  const poll = (p: any) => ({ voters: [{ name: "Me" }, { name: "B" }], polls: [{ id: "a", status: "live", title: "T", options: ["x", "y"], ...p }] });
  expect(() => app.parse("{")).toThrow(/Not valid JSON/);
  expect(bad({ voters: [], polls: [] })).toThrow("voters: needs at least one voter");
  expect(bad({ voters: [{ name: "Me", attrs: ["x"] }], polls: [] })).toThrow('voters[0].attrs[0]: unknown attribute "x"');
  expect(bad(poll({ status: "open" }))).toThrow("polls[0].status");
  expect(bad(poll({ ballots: [{ voter: 2, alloc: {} }] }))).toThrow("polls[0].ballots[0].voter: this poll is open to keys 0–1");
  expect(bad(poll({ ballots: [{ voter: 1, alloc: {} }, { voter: 1, alloc: {} }] }))).toThrow('polls[0].ballots[1]: duplicate voter "1"');
  expect(bad(poll({ ballots: [{ voter: 1, alloc: { 2: 1 } }] }))).toThrow('polls[0].ballots[0].alloc: "2" is not an option number');
  expect(bad(poll({ ballots: [{ voter: 1, alloc: { 0: 2 } }] }))).toThrow("spends 2 tokens but voter 1 holds 1");
});

test("the address bar drives navigation: pages push, filters replace, other params are kept", () => {
  const { app, g, pushed } = mount("?src=x.json&poll=p1&tab=ledger&layout=radial&theme=night", {}, () => new Response("{}", { status: 404 }));
  expect(app.state).toMatchObject({ view: "poll", pollId: "p1", tab: "ledger", layout: "radial", theme: "night" });
  app.setState({ q: "nope" });
  expect(g.location.search).toBe("?src=x.json&poll=p1&tab=ledger&layout=radial&theme=night");
  app.setState({ view: "dashboard" });
  app.setState({ filter: "drafts", q: "solar" });
  expect(g.location.search).toBe("?src=x.json&filter=drafts&q=solar&theme=night");
  expect(pushed).toEqual(["/app/?src=x.json&q=nope&theme=night"]);
  g.location.search = "?poll=p5"; app._onPop();
  expect(app.state).toMatchObject({ view: "poll", pollId: "p5", tab: "vote", filter: "all", q: "" });
});

test("?src= loads that file without saving it; opening a file saves it and drops ?src=", async () => {
  const store: Record<string, string> = {};
  const file = JSON.stringify({ title: "Club", voters: [{ name: "Me" }], polls: [{ id: "q", status: "live", title: "Lunch?", options: ["Yes", "No"] }] });
  const { app, g } = mount("?src=club.json", store, (u) => { expect(u).toBe("https://x.test/app/club.json"); return new Response(file); });
  await Bun.sleep(0);
  expect(app.state.docTitle).toBe("Club");
  expect(store["tally:json:v1"]).toBeUndefined();
  app.adopt(file.replace("Club", "Club 2"), "club.json");
  expect(g.location.search).toBe("");
  expect(JSON.parse(store["tally:json:v1"]).title).toBe("Club 2");
});

test("a cast ballot is saved and reloads as the same leaf", () => {
  const store: Record<string, string> = { "tally:json:v1": EXAMPLE };
  const { app } = mount("?poll=p2", store);
  app.setState({ allocs: { p2: { 0: 1 } } });
  app.cast();
  const mine = app.state.polls.find((p: any) => p.id === "p2").ballots.at(-1);
  const again = mount("", store).app.state.polls.find((p: any) => p.id === "p2").ballots.at(-1);
  expect(again).toEqual(mine);
  expect(mine.vi).toBe(0);
});
