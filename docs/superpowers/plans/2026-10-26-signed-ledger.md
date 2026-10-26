# Signed Vote Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Tally's simulated voters, ballots and Merkle tree with a real, self-validating ledger: a signed mint
of subjects → keys → weights, then signed votes chained by blake3 SAIDs, which anyone can verify from `tally.json` alone.

**Architecture:** The ledger is a new DOM-free ES module, `ledger.js` (CESR encoding, canonical form, SAIDs, signing,
entry builders, `verify`, file parse/serialize), tested directly by Bun. It imports one vendored bundle,
`vendor/noble.js` (blake3 + ed25519). `Tally.dc.html` loads `ledger.js` with a `<script type="module">` that sets
`window.TallyLedger` before the dc runtime boots, and its logic class becomes a thin UI over that module plus a demo
keyring in browser storage.

**Tech Stack:** Plain JS (no build), dc runtime (`support.js`), `@noble/hashes` 2.0.1 (blake3), `@noble/curves` 2.0.1
(ed25519), Bun (tests, bundling the vendor file, `make dev`).

**Spec:** `docs/superpowers/specs/2026-10-26-signed-ledger-design.md`

## Global Constraints

- No build step for the app: `Tally.dc.html`, `support.js`, `ledger.js`, `vendor/noble.js` are served as-is (GitHub Pages, `make dev`).
- Crypto only from `@noble/hashes` and `@noble/curves`, pinned to exactly `2.0.1`; bundled once into `vendor/noble.js`, which is committed.
- Every entry has `"v": "tally/1"`. Hashes are SAIDs: blake3-256, CESR code `E`, 44 chars. Keys: Ed25519, CESR code `D`. Signatures: Ed25519, CESR code `0B`, 88 chars.
- A private key is never written to `tally.json`. Demo keys live in localStorage key `tally:keys:v1`; the document lives in `tally:json:v2` (the old `tally:json:v1` is ignored).
- Tally only appends to a chain; nothing already written is rewritten.
- Malformed files are rejected with a path; well-formed files that fail verification load and show every failure.
- Keep: themes, header, Open/Download, `?src=` (not autosaved), `?theme=`, URL navigation with push/replace, toasts.
- `bun test` must pass at the end of every task.

## Review Focus

1. A hand-edited file whose fields were reordered or re-indented must still verify (SAIDs are computed from the canonical form, not the file's text) → Task 1 test `canonical form ignores field order`.
2. A hand-edited vote (allocation changed, `d` left alone) must load, show `said` and `vote-sig` failures on that row, and still check every later entry → Task 2 test `a tampered vote is reported and later entries are still checked`.
3. Weights that are 0, negative, fractional or strings, and a `total` that doesn't match → `parseFile` rejects bad types (Task 3); a wrong `total` loads and fails rule `total` (Task 2).
4. Voting twice from the UI (double click, or the same subject again) must not append a second vote → Task 6 test `a subject can vote once`.
5. Opening a poll in a browser that holds none of its keys: it loads read-only and the Vote tab says no keys are held here, instead of erroring → Task 6 test `without keys the vote tab is read-only`.

---

### Task 1: CESR, canonical form, SAIDs and signatures

**Files:**
- Create: `voting/package.json`, `voting/vendor/noble.entry.js`, `voting/vendor/noble.js` (generated), `voting/ledger.js`, `voting/ledger.test.ts`
- Modify: `voting/Makefile` (add `vendor` target), `voting/.gitignore` (create; `node_modules/`)

**Interfaces:**
- Produces (exports of `ledger.js`):
  - `cesrEncode(code: 'D'|'E'|'0B', raw: Uint8Array): string` / `cesrDecode(s: string): { code: string, raw: Uint8Array }`
  - `FIELDS: { mint: string[], vote: string[], close: string[] }`
  - `canonical(entry): string` — compact JSON of `entry` without `sig`, fields in `FIELDS[entry.t]` order, `alloc` keys in ascending numeric order, nested `organiser` as `id, keys` and each subject as `id, keys, weight`.
  - `said(entry): string` — SAID of `entry` (ignores its current `d`).
  - `newKeypair(): { pub: string, secret: string }` — `pub` is CESR `D…`; `secret` is the 32-byte seed as base64url.
  - `sign(entry, secret: string): string` — `0B…` over `canonical(entry)` with `d` filled.
  - `verifySig(entry, pub: string, sig: string): boolean` — false (never throws) for malformed keys or signatures.

- [ ] **Step 1: Vendor the libraries.** `package.json`: `{ "private": true, "devDependencies": { "@noble/hashes": "2.0.1", "@noble/curves": "2.0.1" } }`. `vendor/noble.entry.js`: re-export `blake3` from `@noble/hashes/blake3.js` and `ed25519` from `@noble/curves/ed25519.js`. Makefile target:

```make
vendor: node_modules/@noble/curves
	bun build vendor/noble.entry.js --outfile vendor/noble.js --format esm --minify
node_modules/@noble/curves: package.json
	bun install
```

Run: `make vendor` → `vendor/noble.js` exists. (If the registry is unreachable, `bun install` can be replaced by copying `../confidential-ledger/node_modules/@noble`, which holds the same 2.0.1 versions.)

- [ ] **Step 2: Write the failing tests** in `ledger.test.ts`:

```ts
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
  const e = { v: "tally/1", t: "close", d: "", p: "y", dt: "t" }; e.d = L.said(e);
  const sig = L.sign(e, k.secret);
  expect(sig).toMatch(/^0B/); expect(L.verifySig(e, k.pub, sig)).toBe(true);
  expect(L.verifySig({ ...e, p: "z" }, k.pub, sig)).toBe(false);
  expect(L.verifySig(e, other.pub, sig)).toBe(false);
  expect(L.verifySig(e, "Dnot-a-key", "0Bnope")).toBe(false);
});
```

- [ ] **Step 3: Run** `bun test ledger.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement** the Task 1 exports in `ledger.js` (`import { blake3, ed25519 } from "./vendor/noble.js"`). CESR: prepend `code.length` zero bytes to `raw`, base64url-encode without padding, replace the first `code.length` characters with `code`; decode reverses it (codes `E`, `D` take 32 bytes, `0B` takes 64). SAID: `canonical` with `d` = `"#".repeat(44)`, blake3 of its UTF-8 bytes, `cesrEncode("E", …)`. `FIELDS`: `mint: v,t,d,title,desc,options,quadratic,organiser,subjects,total,dt`, `vote: v,t,d,p,subject,alloc,dt,key`, `close: v,t,d,p,dt` (`sig` is never part of the canonical form). Before relying on the CESR codes, check them against the CESR code table (`D` Ed25519 verkey, `E` Blake3-256, `0B` Ed25519 signature) and note the source in a comment.

- [ ] **Step 5: Run** `bun test ledger.test.ts` → PASS.

- [ ] **Step 6: Commit** `git add package.json vendor ledger.js ledger.test.ts Makefile .gitignore && git commit -m "feat: ledger primitives (CESR, SAIDs, ed25519)"`

### Task 2: Entry builders and verification

**Files:**
- Modify: `voting/ledger.js`, `voting/ledger.test.ts`

**Interfaces:**
- Consumes: Task 1 exports.
- Produces:
  - `cost(alloc: Record<string, number>, quadratic: boolean): number`
  - `makeMint(fields: { title, desc, options: string[], quadratic: boolean, organiser: { id, keys: string[] }, subjects: { id, keys: string[], weight: number }[], dt: string }, organiserSecret: string): Mint` — sets `v`, `t`, `total` (sum of weights), `d`, `sig`.
  - `makeVote(chain: Entry[], fields: { subject, alloc, key, dt }, secret: string): Vote` — `p` = last entry's `d`.
  - `makeClose(chain: Entry[], dt: string, organiserSecret: string): Close`
  - `verify(chain: Entry[]): Verdict`, where `Verdict = { ok: boolean, failures: { index: number, rule: string, message: string }[], status: 'live'|'closed', totals: number[], voted: Record<string, number> /* subject → entry index */, used: number, total: number }`. Rule ids: `first`, `said`, `link`, `mint-sig`, `total`, `subject`, `vote-sig`, `double`, `options`, `cost`, `close`. `totals` and `used` count only votes that pass every rule.

- [ ] **Step 1: Write the failing tests** (a helper `demo()` mints `alice` weight 4 and `bob` weight 8, options `["Yes","No"]`, and returns `{ chain, keys }`):
  - `a fresh mint verifies` → `verify([mint])` is `{ ok: true, status: "live", total: 12, used: 0, totals: [0, 0] }`.
  - `votes add up` → alice `{0:3}`, bob `{1:8}` → `ok`, `totals` `[3, 8]`, `used` 11, `voted` `{ alice: 1, bob: 2 }`.
  - `quadratic cost is the sum of squares` → `cost({0:2,1:1}, true)` is 5, `cost({0:2,1:1}, false)` is 3; a quadratic poll rejects alice `{0:3}` (9 > 4) with rule `cost`.
  - `each rule reports` → separate chains failing `first` (vote first), `link` (wrong `p`), `mint-sig` (mint signed by a non-organiser key), `total` (mint `total` edited to 13 and re-SAIDed), `subject` (`carol`), `vote-sig` (alice's vote signed with bob's key), `double` (alice twice), `options` (`{5:1}`), `cost` (alice `{0:5}`), `close` (a vote after a close). Each asserts `ok` false and `failures.map(f => f.rule)` contains exactly the expected rule.
  - `a tampered vote is reported and later entries are still checked` → edit alice's `alloc` in place without re-SAIDing; expect failures `said` and `vote-sig` at index 1, a `link` failure at index 2 is **not** expected (bob's `p` still equals the stored `d`), and bob's vote still counts.
  - `close ends the poll` → `makeClose` → `status` `"closed"`.

- [ ] **Step 2: Run** `bun test ledger.test.ts` → the new tests FAIL.

- [ ] **Step 3: Implement** the Task 2 exports. `verify` walks the chain once, collects every failure (it never stops early), links each entry's `p` to the previous entry's **stored** `d`, and accepts a signature from any key listed for the signer (any organiser key for mint and close; the vote's `key` must be one of the subject's minted keys). An entry that fails any rule is not counted in `totals`/`used`, but its subject still counts as having voted for rule `double`.

- [ ] **Step 4: Run** `bun test ledger.test.ts` → PASS.

- [ ] **Step 5: Commit** `git commit -am "feat: mint/vote/close entries and chain verification"`

### Task 3: The file format

**Files:**
- Modify: `voting/ledger.js`, `voting/ledger.test.ts`

**Interfaces:**
- Produces:
  - `parseFile(text: string): Doc`, `Doc = { polls: Entry[][], drafts: Draft[] }`, `Draft = { id: string, title: string, desc: string, options: string[], quadratic: boolean, organiser: string, subjects: { id: string, keys: string[], weight: number }[] }`. Throws `Error("<path>: <message>")`, e.g. `polls[0][2].alloc.1: expected a whole number ≥ 0`.
  - `serializeFile(doc: Doc): string` — `JSON.stringify(doc, null, 2)` with short arrays/objects collapsed to one line (move Tally's current `serialize` collapse into here) and a trailing newline.

- [ ] **Step 1: Write the failing tests:**
  - `a file round-trips` → `serializeFile(parseFile(serializeFile(doc)))` equals `serializeFile(doc)` for a doc with one chain of 3 entries and one draft.
  - `shapes are checked with paths` → rejects: not JSON (`Not valid JSON`); missing `polls` (`polls: expected a list`); an entry with `t: "ballot"` (`polls[0][0].t`); a mint weight of `0`, `-1`, `1.5`, `"4"` (`polls[0][0].subjects[0].weight`); a vote `alloc` value `-1`; an unknown entry field (`polls[0][1].extra: unknown field`); a draft without `title`.
  - `the old format is not read` → the old `{ title, voters, polls: [{ id, status, ballots }] }` shape throws with a path under `polls[0]`.
  - `a well-formed file that fails verification still parses` → a chain with an edited `total` parses; `verify` reports `total`.
  - `drafts may be empty or incomplete` → a draft with no options and no subjects parses.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `parseFile` (shape only, never verification; draft fields optional except `id` and `title`, defaulting to `""`, `[]`, `false`, `"Organiser"`) and `serializeFile`.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `git commit -am "feat: tally.json v2 file format"`

### Task 4: Tally's data layer over the ledger

**Files:**
- Modify: `voting/Tally.dc.html` (script and head), `voting/app.test.ts` (rewrite the harness and data tests)
- Delete: `voting/BallotCard.dc.html`

**Interfaces:**
- Consumes: `window.TallyLedger` = the `ledger.js` module.
- Produces (logic-class members later tasks use):
  - state: `doc: Doc`, `verdicts: Record<pollId, Verdict>` (recomputed whenever `doc` changes), `view`, `pollId` (a mint SAID), `editId` (a draft id), `tab: 'vote'|'ledger'|'results'`, `filter: 'all'|'todo'|'voted'|'drafts'|'closed'`, `q`, `sort: 'new'|'votes'`, `theme`, open-dialog fields as today.
  - `keyring(): Record<string /*pub*/, string /*secret*/>` and `remember(pub, secret)` over localStorage `tally:keys:v1`.
  - `setDoc(doc: Doc)` — the only way state's `doc` changes; recomputes `verdicts`; saving to `tally:json:v2` happens in `componentDidUpdate` (skipped while `this.src !== null`, as today).
  - `append(pollId: string, entry: Entry)` — pushes onto that chain via `setDoc`.
  - `poll(pollId): { chain, mint, verdict }`, `mine(pollId): { id, keys, weight }[]` — subjects whose keys this browser holds.

- [ ] **Step 1: Rewrite the harness** in `app.test.ts`: as today, plus `g.window.TallyLedger = await import("./ledger.js")` and a `crypto` global, and a fixture builder that makes a doc with one minted poll and one draft via `ledger.js`.

- [ ] **Step 2: Write the failing tests:**
  - `a fresh start is empty` → `doc` is `{ polls: [], drafts: [] }`.
  - `the saved v2 doc loads; v1 is ignored` → store with `tally:json:v1` only → empty; with `tally:json:v2` → that doc.
  - `?src= loads without saving; opening a file saves it and drops ?src=` → as today's test, with v2 docs.
  - `the address bar drives navigation` → as today, with `?poll=<said>&tab=ledger` and `?edit=<draftId>`; `layout`/`group` params are gone.
  - `dashboard rows come from chains` → a live poll shows status `Live` and `Verified`; a poll with an edited `total` shows `Broken`.

- [ ] **Step 3: Run** `bun test` → FAIL.

- [ ] **Step 4: Implement.** In `<head>`, before `support.js`: `<script type="module">import * as L from "./ledger.js"; window.TallyLedger = L;</script>` (module scripts run before `DOMContentLoaded`, which the runtime waits for). Delete the simulated model and everything only it uses: `sha`, `blob`-based ballot helpers that need fake keys, `poolFor`, `mkVoter`, `mkBallot`, `leafHash`, `ktree`, `ledgerCommon`, `kcard`, tamper/proof/tree/carousel/radial/fisheye state and templates, `ATTRS`, rules, `anonymous`/`showWeights`, `startOn`/`layout`/`groupSize`/`hashChars` props, and the old `parse`/`serialize`/`load`/`toDoc`. Keep the avatar `blob()` drawing if the views below still use identicons. Dashboard rows: title from the mint (or draft), status `Draft`/`Live`/`Closed`, a `Verified`/`Broken` chip from the verdict, meta `"<votes> of <subjects> subjects voted · <used>/<total> weight"`; filter `todo` = live polls where `mine()` has a subject that hasn't voted, `voted` = polls where one of `mine()` has voted.

- [ ] **Step 5: Run** `bun test` → PASS.

- [ ] **Step 6: Commit** `git commit -am "feat: Tally state over the signed ledger"`

### Task 5: Drafts and minting

**Files:**
- Modify: `voting/Tally.dc.html` (editor template and `editorVals`), `voting/app.test.ts`

**Interfaces:**
- Consumes: Task 4 state and helpers; `makeMint`, `newKeypair`.
- Produces: `newDraft(): string` (returns the draft id), `mintDraft(draftId): string` (returns the new poll id).

- [ ] **Step 1: Write the failing tests:**
  - `a new draft is saved in the file` → `newDraft()` adds a draft with two empty options and one empty subject row; `view` is `editor`.
  - `minting turns the draft into a verified chain` → fill title, options `["Yes","No"]`, subjects `alice` 4 / `bob` 8 with no keys → `mintDraft` → the draft is gone, a chain of one mint exists, `verify` is `ok` with `total` 12, both subjects got a `D…` key, the organiser's and subjects' secrets are in `tally:keys:v1`, and `tally:json:v2` contains no secret.
  - `minting is refused when the draft is incomplete` → no title, fewer than two options, no subjects, a blank or duplicate subject id, or a weight below 1 → a toast naming the problem, no chain.
  - `pasted keys are kept` → a subject with a pasted valid `D…` key keeps it and no secret is stored for it; an invalid pasted key refuses the mint.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** Editor (drafts only): title, description, options (add/remove), quadratic toggle, organiser name, and a mint table in the style of confidential-ledger's "Mint New Ledger": one row per subject with id, weight, keys (blank = generate) and remove, then **+ Add row**, a running total, **Delete draft** and **Mint**. Mint: generate the organiser keypair and any missing subject keypairs, `remember` their secrets, `makeMint` with `dt = new Date().toISOString()`, move the draft into `polls`, open the poll. Delete the weight-rules, attributes, voter-preview and summary panels.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `git commit -am "feat: drafts and minting"`

### Task 6: Voting, results and closing

**Files:**
- Modify: `voting/Tally.dc.html` (poll template, `pollVals`), `voting/app.test.ts`

**Interfaces:**
- Consumes: Task 4–5; `makeVote`, `makeClose`, `cost`.
- Produces: `castAs(pollId, subject, alloc)`, `closePoll(pollId)`, state `voteAs: string | null`, `allocs: Record<pollId, Record<string, number>>`.

- [ ] **Step 1: Write the failing tests:**
  - `a subject can vote once` → as `alice`, allocate `{0:3}`, cast → the chain grows by one verified vote; casting again as alice (and calling `castAs` twice in a row) appends nothing; `alice` is no longer offered.
  - `allocations are limited by weight` → plain: the +1 control is disabled once spent = weight; quadratic: next vote costs `(k+1)² − k²`.
  - `without keys the vote tab is read-only` → a doc whose keys aren't in this keyring: no subjects offered, text `"This browser holds none of this poll's keys."`, no cast button.
  - `results come from the verdict` → totals per option equal `verdict.totals`, with `"<used> of <total> weight used"`.
  - `the organiser can close` → with the organiser's key, Close appends a verified close, status `Closed`, voting disabled; without it, no Close button.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** Poll page tabs: Vote, Ledger, Results. Vote: "Vote as" picker over `mine(pollId)` minus subjects that have voted, the existing up/down allocation rows with budget = that subject's weight, **Sign & cast**, and a "Sign it for real…" link (Task 8). Results: bars per option from `verdict.totals`. Close button in the poll header when the organiser key is held and the poll is live.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `git commit -am "feat: signed voting, results and closing"`

### Task 7: The ledger table

**Files:**
- Modify: `voting/Tally.dc.html` (ledger template, `ledgerVals(pollId)`), `voting/app.test.ts`

**Interfaces:**
- Consumes: `verify`, Task 4 helpers.
- Produces: `ledgerVals(pollId)` → `{ badge, failures, subjects, entries, totals }` for the template.

- [ ] **Step 1: Write the failing tests:**
  - `the badge names the organiser` → verified poll: badge text `"Verified · minted by Organiser D…"` (key shortened); broken: `"Broken · <n> problem(s)"` and a failures list with `"#<index> <rule>: <message>"`.
  - `rows mirror the chain` → one entry row per entry with kind, subject, allocation text (`"Yes ×3"`), weight, short `p → d`, signature `✓`/`✗`; a failing row is flagged; subjects table rows show id, short keys, weight, and voted `✓` or `—`; totals row matches `verdict.totals` and `used/total`.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** the Ledger tab: subjects table (the mint), entries table, totals row, badge and failures (each failure scrolls to and highlights its row), using the existing theme tokens; full hashes in `title` attributes.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `git commit -am "feat: ledger table with verification"`

### Task 8: "Sign it for real" modal

**Files:**
- Modify: `voting/Tally.dc.html`, `voting/app.test.ts`

**Interfaces:**
- Consumes: `canonical`, `said`; the vote being prepared (Task 6), or the mint/close being prepared.
- Produces: state `realOpen: null | { title: string, bytes: string, said: string, principal: string }`.

- [ ] **Step 1: Write the failing test** `the modal shows the exact bytes` → opening it from the Vote tab as alice with `{0:3}` shows `bytes` equal to `canonical(<the vote makeVote would produce>)` with `d` filled, its `said`, and the script below with `alice` as the principal.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** the modal, opened from the Vote tab, the editor's Mint (principal = organiser name) and Close (same structure and styling as the Open dialog): the entry bytes in a monospace block with **Copy** and **Download entry.json**, the SAID, then this script (exact copy, `<principal>` substituted):

```sh
ssh-keygen -t ed25519 -f tally_key -N '' -C <principal>
# Save the entry above as entry.json, then:
ssh-keygen -Y sign -f tally_key -n tally entry.json          # writes entry.json.sig
echo "<principal> $(cat tally_key.pub)" > allowed_signers
ssh-keygen -Y verify -f allowed_signers -I <principal> -n tally -s entry.json.sig < entry.json
```

and the note: "`ssh-keygen -Y` wraps the signature in SSH's own format, so Tally can't take it in yet. A raw Ed25519 signature (`openssl pkeyutl -sign -rawin -inkey key.pem -in entry.json`) is the format Tally stores. In real use, the voter's KERI wallet signs."

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `git commit -am "feat: sign-it-for-real modal"`

### Task 9: Example, docs and publishing

**Files:**
- Create: `voting/scripts/make-example.ts`
- Modify: `voting/examples/harbor-commons/tally.json` (regenerated), `voting/examples/harbor-commons/README.md`, `voting/schema.md` (rewrite for v2), `voting/README.md`, `voting/.github/workflows/pages.yml`, `voting/Makefile`, `voting/app.test.ts`

**Interfaces:**
- Consumes: `makeMint`, `makeVote`, `makeClose`, `serializeFile`.

- [ ] **Step 1: Write the failing test** `the example verifies` → `parseFile` of the example succeeds, it has at least two polls, one closed, every verdict is `ok`, and the JSON example in `schema.md` parses.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `scripts/make-example.ts` (Make target `example`): mints "Harbor Commons" polls reusing today's poll titles and options with 10 named subjects and varied weights, casts votes, closes one poll, writes the file, and discards every secret. Rewrite `schema.md` for the v2 format (entries, field orders, SAID and signature rules, verification rules, drafts) from the spec; update README (no Merkle/tamper features; ledger, mint, keyring, sign-it-for-real) and the example README; in `pages.yml` copy `ledger.js vendor` and drop `BallotCard.dc.html`.

- [ ] **Step 4: Run** `make example && bun test` → PASS; `git status` shows no secrets in any tracked file (`grep -r secret examples` finds nothing).

- [ ] **Step 5: Commit** `git commit -am "docs: v2 example, schema and README"`
