// Regenerates examples/harbor-commons/tally.json: real signed polls whose private keys are thrown away afterwards.
// Run with `make example`. Every run makes new keys, so the file (and its SAIDs) change each time.
import * as L from "../ledger.js";

const people: [string, number][] = [["Sam Rivera", 9], ["Maya Chen", 17], ["Jonas Albers", 5], ["Priya Raman", 12], ["Theo Brandt", 8],
  ["Ada Okoro", 16], ["Luis Ferreira", 6], ["Hana Sato", 9], ["Omar Haddad", 13], ["Ines Duarte", 4]];
let minute = 0;
const dt = () => new Date(Date.UTC(2026, 9, 20, 9, minute++)).toISOString();

function poll(title: string, desc: string, options: string[], quadratic: boolean, votes: [number, Record<string, number>][], close = false) {
  const org = L.newKeypair(), keys = people.map(() => L.newKeypair());
  const chain: any[] = [L.makeMint({ title, desc, options, quadratic, organiser: { id: "Harbor Commons board", keys: [org.pub] },
    subjects: people.map(([id, weight], i) => ({ id, keys: [keys[i].pub], weight })), dt: dt() }, org.secret)];
  for (const [i, alloc] of votes) chain.push(L.makeVote(chain, { subject: people[i][0], alloc, key: keys[i].pub, dt: dt() }, keys[i].secret));
  if (close) chain.push(L.makeClose(chain, dt(), org.secret));
  return chain;
}

// A sealed poll: allocations are sealed, and the organiser's tally (if tallied) publishes totals anyone can check.
async function sealedPoll(title: string, desc: string, options: string[], quadratic: boolean, votes: [number, Record<string, number>][], tally: boolean) {
  const org = L.newKeypair(), enc = L.newEncKeypair(), keys = people.map(() => L.newKeypair());
  const chain: any[] = [L.makeMint({ title, desc, options, quadratic, kind: "sealed", organiser: { id: "Harbor Commons board", keys: [org.pub], enc: enc.pub },
    subjects: people.map(([id, weight], i) => ({ id, keys: [keys[i].pub], weight })), dt: dt() }, org.secret)];
  for (const [i, alloc] of votes) chain.push((await L.makeSealedVote(chain, { subject: people[i][0], alloc, key: keys[i].pub, dt: dt() }, keys[i].secret)).entry);
  if (tally) chain.push(await L.makeTally(chain, { secret: org.secret, encSecret: enc.secret }, dt()));
  return chain;
}

const doc = {
  polls: [
    poll("Convert the Elm St. lot into a community garden?", "The city has offered the vacant lot on a 10-year lease. A yes vote commits the association to seasonal upkeep.",
      ["Yes, build the garden", "No, keep it as parking", "Defer to the spring meeting"], true,
      [[1, { 0: 4, 2: 1 }], [3, { 0: 3, 1: 1 }], [4, { 1: 2, 2: 2 }], [5, { 0: 4 }], [7, { 2: 3 }]]),
    poll("Which Q4 project gets the discretionary budget?", "One project will be funded from the remaining $18,000.",
      ["Protected bike lanes on 5th", "Extended library hours", "Street lighting on Harbor Rd", "Quarterly park cleanup"], true,
      [[1, { 0: 2, 2: 3 }], [2, { 1: 2, 3: 1 }], [6, { 2: 2, 3: 1 }], [8, { 0: 3, 1: 2 }]]),
    poll("Pilot a four-day work week in Q1", "A 12-week pilot for all full-time staff, reviewed at the end of March.",
      ["Yes, run the pilot", "No"], false, [[0, { 0: 9 }], [2, { 1: 5 }], [5, { 0: 10, 1: 6 }], [8, { 0: 13 }]]),
    poll("Name the new co-op café", "Shortlisted from 40 member suggestions.", ["Common Grounds", "The Pour House", "Elm & Ember"], true,
      [[3, { 2: 3, 0: 1 }], [6, { 1: 2 }], [9, { 2: 2 }]]),
    poll("Move the monthly all-hands to Thursdays", "Tuesdays conflict with the regional ops call for half the team.", ["Thursdays", "Keep Tuesdays"], false,
      [[0, { 0: 9 }], [1, { 0: 17 }], [2, { 1: 5 }], [3, { 0: 12 }], [4, { 1: 8 }], [5, { 0: 16 }], [7, { 0: 4, 1: 5 }], [9, { 1: 4 }]], true),
    await sealedPoll("Elect the association treasurer", "A secret ballot: the board tallies, everyone can check the totals.", ["Priya Raman", "Omar Haddad", "Ines Duarte"], false,
      [[0, { 0: 9 }], [1, { 1: 10, 0: 7 }], [2, { 2: 5 }], [4, { 0: 8 }], [5, { 1: 16 }], [6, { 2: 6 }], [8, { 1: 13 }], [9, { 0: 4 }]], true),
    await sealedPoll("Raise annual dues to $120?", "Sealed until the board tallies at the end of the month.", ["Yes", "No"], true,
      [[1, { 0: 3, 1: 2 }], [3, { 1: 3 }], [7, { 0: 3 }]], false),
  ],
  drafts: [{ id: "neighborhood-fund", title: "Allocate the $50k neighborhood fund", desc: "", options: ["Playground repairs", "Tree planting", "Small business grants"],
    quadratic: true, organiser: "Harbor Commons board", subjects: people.map(([id, weight]) => ({ id, keys: [], weight })) }],
};
for (const c of doc.polls) { const v = L.verify(c); if (!v.ok) throw new Error(c[0].title + ": " + JSON.stringify(v.failures)); }
await Bun.write(new URL("../examples/harbor-commons/tally.json", import.meta.url), L.serializeFile(doc));
console.log("Wrote examples/harbor-commons/tally.json (" + doc.polls.length + " polls, secrets discarded)");
