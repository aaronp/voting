# Ballot Kinds, Verifiable Views and Test Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sealed ballot kind next to the open one, bring back the tree / fisheye / carousel / radial views with find-my-vote and tamper mode over the real signed chain, and move demo sign-in onto a test accounts page with a per-poll "who are you?" chooser.

**Architecture:** `ledger.js` gains a Merkle tree over entry SAIDs (with a signed `root` in close/tally entries), Pedersen seals, ECIES openings and the sealed vote/tally entries and rules. Tally keeps its single-page dc structure: the old view logic and templates come back from commit `e5a967a` (`ktree`/`expOf`/`reveal`/`scrollToSel`/`measureTree`/`nodeAv`/`kcard`/`ledgerCommon`, the `pv.isLedger` template block at old lines 232–405, and `BallotCard.dc.html`), re-pointed at chain entries instead of fake ballots.

**Tech Stack:** As before (no build, dc runtime, Bun tests), plus `ristretto255`, `ristretto255_hasher`, `x25519` from `@noble/curves/ed25519.js` and `hkdf`, `sha256` from `@noble/hashes`, bundled into `vendor/noble.js`; AES-GCM through Web Crypto.

**Spec:** `docs/superpowers/specs/2026-10-27-ballot-kinds-and-views-design.md` (builds on `2026-10-26-signed-ledger-design.md`)

## Global Constraints

- No build step; the only crypto is `@noble/curves` / `@noble/hashes` 2.0.1 via the committed `vendor/noble.js`, plus Web Crypto AES-GCM.
- Existing open-ballot files stay readable and keep verifying; close entries without `root` stay valid.
- The signed root uses group size **10**: the tree over every entry before the close/tally entry, mint included; a short last group hashes the children it has.
- A sealed poll ends only with its tally entry; a plain `close` on a sealed poll fails verification. Results for a sealed poll appear only after the tally.
- Tamper mode is in memory only: it never changes `state.doc`, the saved copy or Download.
- No private key, encryption secret or seal opening ever reaches `tally.json` in plain form; a voter's own openings live in localStorage `tally:openings:v1`, test accounts in `tally:accounts:v1`, the current subject per poll in `tally:as:v1`.
- Every poll and draft shows a "How this poll works" card whose text says what its kind guarantees and what it doesn't (copy in Task 5).
- Keep working: themes, header, URL navigation, Open/Download, `?src=`, the Ledger table, "Sign it for real".

## Review Focus

1. A sealed ballot whose seals don't match its encrypted opening (or whose opening won't decrypt) must be excluded by the tally with a reason, not crash the tally → Task 3 test `the tally excludes ballots that don't open`.
2. Switching group size on a closed poll must not show a false root mismatch → Task 6 test `the signed root is only compared at group size 10`.
3. Tamper edits must never reach the saved document or Download → Task 7 test `tamper mode never touches the saved document`.
4. A poll opened in a browser holding none of its subjects' keys must still show the tree and Ledger read-only, with no chooser blocking it → Task 4 test `browsing without an account is read-only`.
5. Generating many test accounts (e.g. 200) and minting a poll from them must stay usable: the tree defaults to a collapsed view above 16 entries, as the old views did → Task 6 test `big trees start collapsed`.

---

### Task 1: Merkle tree and signed root

**Files:**
- Modify: `voting/ledger.js`, `voting/ledger.test.ts`

**Interfaces:**
- Produces:
  - `merkle(leaves: string[], k: number): string[][]` — levels from leaves up; each node is `cesrEncode('E', blake3(utf8(children.join(''))))`; a short last group hashes what it has; one leaf still gets one parent level.
  - `ROOT_GROUP = 10`; `rootOf(chain: Entry[]): string` = `merkle(chain.map(e => e.d), 10)` top node.
  - `makeClose(chain, dt, organiserSecret)` now also writes `root: rootOf(chain)` and `group: 10`.
  - `FIELDS.close = ['v','t','d','p','root','group','dt']`; parseFile: `root` (text) and `group` (whole number ≥ 2) optional on close.
  - New verify rule `root`: a close/tally with `root` must equal `merkle(saids of entries before it, group)` top node.

- [ ] **Step 1: Write the failing tests:** `merkle groups and rolls up` (5 leaves, k=2 → level sizes `[5,3,2,1]`; k=10 → `[5,1]`; one leaf → `[1,1]`; every node matches `/^E[A-Za-z0-9_-]{43}$/`); `close records the signed root` (`makeClose` → `root === L.rootOf(chain before close)`, `group === 10`, `verify` ok); `a wrong root fails rule root` (edit `root`, re-SAID and re-sign with the organiser key → rules `["root"]`); `old closes without a root still verify` (delete `root`/`group`, re-SAID, re-sign → ok).
- [ ] **Step 2: Run** `bun test ledger.test.ts` → the new tests FAIL.
- [ ] **Step 3: Implement** the Task 1 interfaces.
- [ ] **Step 4: Run** `bun test` → PASS (all 43 existing tests still pass).
- [ ] **Step 5: Commit** `git commit -am "feat: Merkle tree over entries; signed root in close"`

### Task 2: Seals and encrypted openings

**Files:**
- Modify: `voting/vendor/noble.entry.js`, `voting/vendor/noble.js` (rebuild with `make vendor`, or `bun build` from the local `node_modules` copy), `voting/ledger.js`, `voting/ledger.test.ts`

**Interfaces:**
- Produces:
  - `seal(v: bigint|number, r: bigint): string` — hex of `G·v + H·r` (ristretto255; `G` base, `H = ristretto255_hasher.hashToCurve(utf8('conf-ledger:H:v1'))`; v = 0 / r = 0 use the zero point), reduced mod the ristretto group order `L = 2^252 + 27742317777372353535851937790883648493`.
  - `addSeals(hexes: string[]): string`; `randomBlind(): bigint`.
  - `newEncKeypair(): { pub: string /* CESR 'C' + X25519 */, secret: string /* base64url */ }`.
  - `encrypt(pub: string, text: string): Promise<string>` / `decrypt(secret: string, payload: string): Promise<string>` — X25519 ephemeral + HKDF-SHA256 (salt `"tally/1"`, info `"opening"`) + AES-GCM (12-byte nonce); payload = base64url(epk ‖ nonce ‖ ciphertext).
  - `cesrEncode` / `cesrDecode` accept code `C` (32 bytes).

- [ ] **Step 1: Write the failing tests:** `seals add up` (`addSeals([seal(3,r1), seal(4,r2)]) === seal(7, (r1+r2) mod L)`); `a seal hides nothing it shouldn't reveal` (`seal(3,r) !== seal(4,r)`, `seal(3,r1) !== seal(3,r2)`); `openings round-trip only for the right key` (`decrypt(k.secret, await encrypt(k.pub, "hi")) === "hi"`; another key's secret rejects); `C keys are CESR` (`newEncKeypair().pub` matches `/^C[A-Za-z0-9_-]{43}$/`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Add `ristretto255, ristretto255_hasher, x25519` and `hkdf`, `sha256` to `noble.entry.js` and rebuild. Note the CESR code source (`C` = X25519 public encryption key) in a comment beside the others.
- [ ] **Step 4: Run** `bun test` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: Pedersen seals and ECIES openings"`

### Task 3: Sealed mints, votes and tallies

**Files:**
- Modify: `voting/ledger.js`, `voting/ledger.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `makeMint(fields, organiserSecret)` accepts `kind: 'open'|'sealed'` (written only when `'sealed'`) and `organiser.enc` (required for sealed). `FIELDS.mint` gains `kind` after `quadratic`; organiser canonical form `id, keys, enc`.
  - `makeSealedVote(chain, { subject, alloc, key, dt }, secret): Promise<{ entry: Vote, opening: { values: number[], blinds: string[] } }>` — `entry` has `seals: string[]` (one per option) and `opening: string` (encrypted JSON of the opening to the mint's `organiser.enc`) instead of `alloc`. `FIELDS.vote = ['v','t','d','p','subject','alloc','seals','opening','dt','key']` (canonical skips absent fields).
  - `makeTally(chain, { secret, encSecret }, dt): Promise<Tally>` — entry `{ v, t: 'tally', d, p, totals: number[], blinds: string[] /* decimal */, used: number, excluded: { index, reason }[], root, group: 10, dt, sig }`; `FIELDS.tally = ['v','t','d','p','totals','blinds','used','excluded','root','group','dt']`.
  - `verify` for sealed mints: votes must carry `seals` (length = options) and `opening`, not `alloc` (rule `options`); no `cost` check; a `close` fails rule `close`; a tally must be organiser-signed (`mint-sig`), last, only once (`close`), its `root` checked (`root`), and for each option the sum of included ballots' seals must equal `seal(totals[i], blinds[i])` (rule `tally`), where included = sealed votes passing all public rules minus `excluded`. After a valid tally: `status: 'closed'`, `totals` and `used` from the tally. Before it: `totals` all 0, `used` 0, `sealed: true` in the verdict.
  - parseFile accepts the new fields and the `tally` entry type.

- [ ] **Step 1: Write the failing tests** (helper `sealedDemo()`: alice 4, bob 8, options Yes/No, organiser with `enc`):
  - `sealed votes verify without revealing allocations` → two sealed votes; `verify` ok, `totals` `[0,0]`; the serialized file contains neither `"alloc"` nor the opening values in plain text.
  - `a tally publishes totals anyone can check` → `makeTally` → ok, `status` closed, `totals` `[3,8]`, `used` 11.
  - `a wrong total fails rule tally` → change `totals[0]`, re-SAID, re-sign → rules `["tally"]`.
  - `the tally excludes ballots that don't open` → one vote whose `opening` is encrypted to a different key, one with `alloc` costing 9 > 4 (quadratic poll) → both in `excluded` with reasons, the rest counted, verify ok.
  - `a close is not allowed on a sealed poll` → rules contain `close`.
  - `open polls are unchanged` → an existing open-poll file still verifies.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** The tally decrypts each sealed vote's `opening`, checks it re-seals to `seals`, that values are whole numbers ≥ 0 and that `cost(values)` is between 1 and the subject's weight; failures become `excluded` reasons (`"does not open"`, `"seals don't match"`, `"costs N, holds W"`).
- [ ] **Step 4: Run** `bun test` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: sealed ballots: mint, vote, tally, verification"`

### Task 4: Test accounts and "who are you?"

**Files:**
- Modify: `voting/Tally.dc.html`, `voting/app.test.ts`

**Interfaces:**
- Produces:
  - `accounts(): { name: string, pub: string }[]`, `addAccount(name): void`, `generateAccounts(n: number): void` (names `voter-001` … continuing after the highest existing number), `removeAccount(pub)`; secrets go through the existing `remember`.
  - `?page=accounts` → `view: 'accounts'` (in `fromQuery`/`toQuery`/`pageKey`); header link "Test accounts".
  - `currentAs(pollId): string|null` and `setAs(pollId, subject|null)` over `tally:as:v1`; valid only if the subject is in the poll and its key is held.
  - Editor: `ed.fromAccounts()` adds every account not already listed as a row `{ id: name, keys: [pub], weight: 1 }`.
  - Poll page: when the poll has subjects whose keys are held and `currentAs` is null, show the chooser ("Who are you?" listing them, plus "Just browsing"); the header shows `as <subject> · Switch`. The Vote tab votes as `currentAs` (replaces the `voteAs` picker; `castAs` signature unchanged).

- [ ] **Step 1: Write the failing tests:** `generate N adds accounts with held keys` (`generateAccounts(3)` → names `voter-001..003`, each `pub` in the keyring; again `generateAccounts(2)` → `voter-004..005`); `drafts can take subjects from accounts`; `choosing an account sets who you are` (fixture with alice/bob keys held → `pv.chooser` lists both; `pick` alice → `currentAs` is `alice`, the Vote tab offers only alice, header text `as alice`); `browsing without an account is read-only` (no keys held → no chooser, Tree and Ledger tabs available, `pv.noKeys` true); `the accounts page has an address` (`?page=accounts` ↔ `view: 'accounts'`).
- [ ] **Step 2: Run** → FAIL. (Update the earlier vote tests that set `voteAs` to call `setAs` instead; record that as a ruling.)
- [ ] **Step 3: Implement** the accounts page (list with name, short key, remove; "Add" field; "Generate N" number field + button; a line saying this stands in for real sign-in and real AIDs are single-use per poll), the editor's "+ Add test accounts" button, the chooser and the header indicator.
- [ ] **Step 4: Run** `bun test` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: test accounts page and per-poll account chooser"`

### Task 5: Sealed ballots in the app, and "How this poll works"

**Files:**
- Modify: `voting/Tally.dc.html`, `voting/app.test.ts`

**Interfaces:**
- Consumes: Tasks 3–4.
- Produces: draft field `kind: 'open'|'sealed'` (parseFile default `'open'`); `mintDraft` generates `organiser.enc` for sealed; `castAs` becomes `async castAs(...): Promise<boolean>` and, for sealed polls, stores the returned opening in `tally:openings:v1` keyed by the vote's `d`; `async tallyPoll(pollId)` (organiser only) replaces Close on sealed polls; `howItWorks(kind): { title, guarantees: string[], doesnt: string[], use: string, later?: string[] }`.

- [ ] **Step 1: Write the failing tests:** `minting a sealed draft adds an encryption key`; `a sealed vote keeps its opening only in this browser` (after `await castAs`, `tally:json:v2` has no `"alloc"`, `tally:openings:v1` has the opening under the vote's `d`); `the organiser tallies a sealed poll` (`await tallyPoll` → verified tally, Results show totals; before it, Results show `"Results appear when the organiser tallies."`); `each kind explains itself` (`howItWorks('open').doesnt[0]` is `"Hide how any subject voted. Privacy rests only on nobody knowing who is behind a subject's AID."`; `howItWorks('sealed').doesnt[0]` is `"Hide votes from the tallier. Anyone can see which ballots were excluded, but must trust the tallier that each exclusion was right."`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Editor: an Open / Sealed choice beside the quadratic toggle, with the card shown under it. Card copy (exact):
  - Open: title "Open ballot"; guarantees "Only minted keys can vote, once each, within their weight.", "Any change to any entry breaks a hash or a signature.", "Anyone can recount the result from the file."; doesn't (above); use "Accountable votes: boards, delegates, roll calls."
  - Sealed: title "Sealed ballot"; guarantees "Only minted keys can vote, once each.", "Any change to any entry breaks a hash or a signature.", "The published totals provably equal the sum of the sealed ballots counted."; doesn't (above); use "Member or community votes where neighbours shouldn't see each other's choices, run by a trusted organiser."; later "Trustees instead of one tallier.", "Proofs that each sealed ballot is within its weight."
  - Show the card on the poll page (collapsible, above the tabs) and in the editor.
- [ ] **Step 4: Run** `bun test` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: sealed ballots in the app; how-this-poll-works cards"`

### Task 6: Tree views over the chain

**Files:**
- Create: `voting/BallotCard.dc.html` (restored from `e5a967a`, re-pointed at entry cards)
- Modify: `voting/Tally.dc.html`, `voting/app.test.ts`, `voting/.github/workflows/pages.yml` (copy `BallotCard.dc.html` again)

**Interfaces:**
- Consumes: `merkle`, `ROOT_GROUP`, `verify`.
- Produces: tab `tree` (`?tab=tree`, with `&layout=` `tree|fisheye|carousel|radial` and `&group=` `2|4|10|16` back in `fromQuery`/`toQuery` on that tab only); `treeVals(pollId)` → the old `ledgerCommon` view model (`rows`, `cards2`, `crows`, `rnodes`, `crumbs`, `layouts`, `groups`, …) built from `merkle(chain.map(e => e.d), k)`, plus `rootCheck: { signed: string|null, computed: string, ok: boolean|null, note: string }`; `entryCard(pollId, index)` → the card the old `kcard` produced, with `label` (subject, or organiser for mint/close/tally), `kind`, `allocText` (open) or `"sealed"` (sealed), `sigText`, `leafShort`, identicon from the SAID, and back-side `fields` (the entry's fields as text).

- [ ] **Step 1: Write the failing tests:** `the tree is built from entry SAIDs` (fixture with 3 votes, group 2 → leaves equal the chain's `d`s and the root equals `L.merkle(ds, 2)` top); `the signed root is only compared at group size 10` (closed poll: at 10 `rootCheck.ok` true; at 2 `ok` null and `note` `"The signed root uses groups of 10."`); `big trees start collapsed` (a poll with 30 entries at group 10 → only the root row expanded initially); `layouts and groups have addresses` (`?poll=X&tab=tree&layout=radial&group=4` round-trips; `layout`/`group` are dropped on other tabs).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** by restoring the old `pv.isLedger` template block as the Tree tab and the old view methods, replacing ballot data with chain entries (`p.ballots[j]` → `chain[j]`, `leafHash` → `e.d`, `T0` = tree of stored `d`s); remove the old proof/"you" assumptions that Task 7 replaces.
- [ ] **Step 4: Run** `bun test` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: tree, fisheye, carousel and radial views over the chain"`

### Task 7: Find my vote and tamper mode

**Files:**
- Modify: `voting/Tally.dc.html`, `voting/app.test.ts`

**Interfaces:**
- Consumes: Tasks 4 and 6.
- Produces: `findMine(pollId)` (selects and reveals `currentAs`'s entry; path to the root highlighted, siblings dashed; a "Find my vote" button on the Tree tab and in the Ledger row); state `tamper: Record<pollId, Record<index, Record<field, string>>>` and `ntamper: Record<pollId:k, Record<'d:i', string>>`; `tampered(pollId): Entry[]` (edited copies, JSON-parsing object fields like `alloc`) whose leaves are `said(editedEntry)` (or an edited `d` as typed); the Tree tab and Ledger table show `verify(tampered)` failures, red nodes and the root vs the signed root while tamper mode is on; **Reset** clears both maps for the poll. For the owner's sealed card, the back shows the opening from `tally:openings:v1`.

- [ ] **Step 1: Write the failing tests:** `find my vote reveals the path` (as alice → selected leaf = alice's index; every ancestor on the path is expanded; siblings flagged); `editing an entry turns its path red` (tamper alice's `alloc` → that leaf and every ancestor differ from the original, root differs from the signed root, the Ledger shows `said` and `vote-sig` for that row); `overwriting a node hash breaks only its ancestors`; `tamper mode never touches the saved document` (after edits, `tally:json:v2` and `L.serializeFile(app.state.doc)` are unchanged; Reset → no differences); `only the owner sees their sealed opening`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: find my vote and tamper mode"`

### Task 8: Example and docs

**Files:**
- Modify: `voting/scripts/make-example.ts`, `voting/examples/harbor-commons/tally.json` (regenerated), `voting/schema.md`, `voting/README.md`, `voting/ledger.test.ts`

- [ ] **Step 1: Write the failing test** `the example has a tallied sealed poll and signed roots` → at least one sealed poll with a valid tally, every close/tally has `root`, every verdict ok, no `"alloc"` in sealed votes.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement:** add a sealed, tallied poll (and one sealed, still open) to the example generator; document in `schema.md` the sealed fields, tally entry, `root`/`group`, rules `root` and `tally`, and the two kinds' guarantees (same copy as the cards); README: ballot kinds, Tree tab, find my vote, tamper mode, test accounts.
- [ ] **Step 4: Run** `make example && bun test` → PASS; `grep -rn '"alloc"' examples` shows only open polls.
- [ ] **Step 5: Commit** `git commit -am "docs: sealed example, schema and README for ballot kinds and views"`
