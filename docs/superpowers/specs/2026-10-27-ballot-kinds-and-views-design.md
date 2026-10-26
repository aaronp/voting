# Ballot kinds, verifiable views and test accounts — design

Status: draft for review · 2026-10-27 · builds on `2026-10-26-signed-ledger-design.md` (implemented on branch `signed-ledger`)

## Why

The signed ledger made Tally's data real, but it dropped what made the old Tally convincing: seeing **all the votes at
once in a picture you can check by eye**. You could find your own place in the whole vote and trust two things:

1. **Privacy:** nobody can tell how a given subject voted.
2. **Integrity:** any change to any piece of data visibly breaks it.

The old views were a simulation (made-up keys, seals and hashes), so they can't simply come back. They return drawn
over real signed data. Privacy only comes back where the data really delivers it, which needs a second kind of
poll. Aaron's rule for all of it: **every poll says plainly how it works, what it guarantees, what it doesn't, and what
it's for.** No parts for technology's sake.

## Goals

1. **Two ballot kinds**, chosen when a poll is drafted, both on the signed hash chain:
   - **Open ballot** (exists today): allocations in plain text.
   - **Sealed ballot** (new): allocations sealed, so the file shows who voted but not how; totals are still checkable by
     anyone.
2. **"How this poll works" card** on every poll and draft: guarantees, non-guarantees, intended use, for its kind.
3. **Verifiable views** over the real entries, for both kinds: tree, fisheye, carousel and radial layouts of a Merkle tree
   whose leaves are the entries' SAIDs.
4. **Find my vote**: highlight the current subject's entry, its path to the root, and the sibling hashes that prove
   inclusion.
5. **Tamper mode**: edit any entry field or any tree hash in memory and see exactly what breaks: rows, links,
   signatures, tree nodes and the root.
6. **Test accounts page** that isolates the demo "sign-in": create subjects by hand or **Generate N**, keys kept in this
   browser. The rest of the app treats the chosen subject as an authenticated user.

## Non-goals

- Bringing back the old simulated data model (fake voters, fake keys, generated leaves).
- Privacy from the tallier in sealed ballots. The organiser who tallies can see individual votes; Aaron accepted this
  for the first version.
- Splitting the tallier key among trustees, and zero-knowledge proofs that a sealed allocation is within weight. Both
  are named as later upgrades.
- Real registration or wallets (unchanged from the previous design).

## Anti-goals

- A view, badge or card that promises more than the data delivers. In particular, hiding allocations in the UI of an
  open ballot, whose file shows them anyway, is out.
- Tamper mode changing the saved document. It is in memory only.
- Any private key or seal opening reaching `tally.json` in plain form.

## Decisions made with Aaron

- An **account is a subject**: one subject in one poll; its vote is its single allocation.
- Keep the open ballot and add a sealed ballot as a second choice when creating a poll.
- Sealed ballot v1: private from the public, **not from the tallier**.
- All three of tree layouts, find-my-vote and tamper mode are wanted.
- A separate test accounts page creates subjects and keys, manually or "generate N".

## The two kinds

### Open ballot (exists)

As built: vote entries carry `alloc` in plain text. The card says:

- **Guarantees:** only minted keys vote; one vote per subject; within weight; tamper-evident; anyone can recount.
- **Doesn't:** hide how any subject voted. Privacy rests only on nobody knowing who is behind a subject's AID.
- **For:** accountable votes: boards, delegates, roll calls.

### Sealed ballot (new)

**Mint.** `"kind": "sealed"` (open mints keep working as today, `kind` absent or `"open"`). The organiser block also
carries an X25519 public key, `organiser.enc`, that ballots are encrypted to. Its secret goes to the keyring like
other demo keys.

**Vote entry** (sealed): instead of `alloc`:

- `seals`: one Pedersen commitment per option (ristretto255, generators as in confidential-ledger's `ferits/shared/crypto.ts`: `G` = base, `H` = hash-to-curve of `"conf-ledger:H:v1"`), CESR- or hex-encoded;
- `opening`: the per-option values and blinding factors, ECIES-encrypted to `organiser.enc` (X25519 + HKDF + AES-GCM,
  as confidential-ledger does).

Both are inside the signed, SAID-ed entry. The voter's browser also keeps its own opening in local storage, so "my
vote" can be shown to its owner.

**Tally entry** (new, sealed polls only; organiser-signed; it closes the poll): per-option totals, per-option sums of
blinding factors, and the list of excluded ballots with reasons. The tallier decrypts every opening and excludes any
ballot that doesn't open, has a negative value, names a bad option, or costs more than the subject's weight (quadratic
allowed).

**Anyone can then check:**

- for each option, the sum of the seals of the included ballots equals `commit(total, blindingSum)`;
- everything the open ballot checks except the allocation itself: keys, one vote each, links, SAIDs, signatures.

The card says:

- **Guarantees:** everything above, plus the published totals provably equal the sum of the sealed ballots counted.
- **Doesn't:** hide votes from the tallier. Anyone can confirm which ballots were excluded, but not *that* each
  exclusion was right; they trust the tallier for that.
- **For:** member or community votes where neighbours shouldn't see each other's choices, run by a trusted organiser.
- **Later:** trustees instead of one tallier; proofs that each ballot is within weight.

Results for a sealed poll appear only after the tally entry. A plain `close` is **not** allowed on a sealed poll
(verify fails it): the tally entry is the only way a sealed poll ends, so there is no "stopped but not tallied" state.
The tallier is whoever's browser holds the organiser's secrets, as with Close today; the account chooser is only for
subjects.

## Verifiable views (both kinds)

- **Tree:** the leaves are the chain's entries in order (their SAIDs). Group size 2, 4, 10 or 16; each node is blake3 of
  its children's hashes joined, rolled up to a root. This is the same shape as the old Tally, with real hashes.
- **Layouts:** tree, fisheye, carousel and radial, with expand/collapse, breadcrumbs and selection, reusing the old
  view code from commit `e5a967a` (`ledgerCommon`, `ktree`, `kcard`, the layout templates and `BallotCard.dc.html`).
- **Leaf cards:** show the entry's kind, subject, its SAID identicon, its signature status and the allocation:
  - open ballot: in plain text;
  - sealed ballot: as seals, with a flip side that shows the opening only on the owner's own card, from local storage.
- **Signed root:** the close entry (open polls) or tally entry (sealed polls) records `root` and `group` (always 10).
  `root` is the tree over every entry before it, mint included, in groups of 10; a short last group hashes whatever
  children it has. The views compare against it when the chosen group size is 10. At other sizes they say "the signed
  root uses groups of 10" instead of showing a false mismatch. Old close entries without `root` stay valid.
- **Find my vote:** select the current subject's entry; highlight its path, and draw its siblings dashed (the inclusion
  proof). Also reachable from the Ledger table.
- **Tamper mode:** a toggle. Flip a card to edit any field of an entry, or overwrite any node hash. Everything is
  recomputed in memory against the untouched original: changed SAIDs, broken `p` links, failed signatures, red nodes up
  to the root, and the root vs the signed root. **Reset** restores it. Nothing is saved.

## Test accounts

- A page (`?page=accounts`) listing test subjects: name and public key, keys held in this browser's keyring.
- **Add** one by name, or **Generate N** (names like `voter-001` …, or a short list of first names), and remove them.
- Drafting a poll picks subjects from this list (all or some), plus weights. Pasting an outside AID and key stays
  possible.
- **Choose account:** opening a poll asks "Who are you?" from the poll's subjects whose keys this browser holds. The
  header then shows the current subject, and every page acts as that subject: Vote, find my vote, opening own seal.
  **Switch** returns to the chooser. Read-only browsing works without choosing.
- The page says plainly that this stands in for real sign-in: in real use, each subject is a single-use AID whose key
  lives in the voter's wallet.

## Constraints

- Same as before: no build step; `@noble/curves` (ristretto255, x25519, ed25519) and `@noble/hashes` (blake3, sha256,
  hkdf) via the vendored bundle; AES-GCM through Web Crypto (async), which also runs under Bun.
- The existing open-ballot format stays readable; the sealed format extends it (`kind`, `organiser.enc`, `seals`,
  `opening`, `tally`).
- Keep everything that works today: themes, header, URL navigation, Open/Download, `?src=`, the Ledger table, the
  "sign it for real" window.

## Left to the builder

- Exact encodings of seals and openings, and the field order of the new entry types (extend `FIELDS`).
- How much of the old view code is reused as-is versus rewritten over the new data.
- Naming list for Generate N; page layout and copy, within the card content above.
- Updating `schema.md`, README, the example (add a sealed poll) and tests.

## Calls I made (Claude) for Aaron to check

1. The old Tally is **not** reinstated as a ballot kind, because it was a simulation. Its views come back over real data
   for both kinds.
2. The sealed ballot's tallier is the organiser, via an X25519 key in the mint; the tally entry closes the poll and
   publishes totals, blinding sums and exclusions.
3. Tallier-checked validity (no range proofs) in v1: the public verifies the totals match the counted seals, not that
   each exclusion was right.
4. The tree's leaves are the chain entries' SAIDs, and the signed root goes into the close/tally entry.
5. Test accounts are reusable across polls in the demo, even though real AIDs are single-use per poll. The page says so.
6. Tamper mode is in memory only and works for both kinds.
7. The signed root always uses groups of 10; other group sizes are for viewing only.
8. A sealed poll ends only with its tally entry (no plain close), and the organiser acts by holding the keys, not through the account chooser.
