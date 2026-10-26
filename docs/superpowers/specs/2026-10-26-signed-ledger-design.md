# Signed vote ledger for Tally — design

Status: draft for review · 2026-10-26

## Why

Tally today shows weighted, "verifiable" polls, but the cryptography is a simulation: voters, weights, keys,
signatures and Merkle hashes are made up in the browser. We want real signed data. A poll file should **stand on its
own**: anyone holding `tally.json` can check, offline and without trusting whoever hosts it, that

- the set of voters and their weights was fixed up front and never changed, and
- every recorded vote was signed by a key that was allowed to vote, at most once per voter, within that voter's weight.

## Where Tally starts (context, not built here)

Registration happens outside Tally. A person proves they meet a published policy ("has credential X", "member of
group Y"; different policies carry different weights) to an OAuth-style verification service, together with a
single-use KERI AID they generated for this poll and a unique identifier that stops them registering twice. The
service issues a `{ pollId, votes }` credential to that AID.

Tally's job starts from the result: **a list of subjects (single-use AIDs), the public keys each may sign with, and
each subject's weight**. In the demo, subjects are names like `alice` and `bob`. Knowing a subject and its keys does
not identify a person, so votes can be public.

(Noted, outside scope: the registration service sees both the unique identifier and the AID, so it can link them.
Blind issuance would remove that link without changing anything in Tally.)

## Goals

1. **Mint**: a poll begins with a fixed list of subjects → allowed keys → weight, and a fixed total weight.
2. **Weight integrity**: the total of the subjects' weights equals the declared total, and it cannot change after minting.
3. **Self-validating**: the file is a hash chain of entries starting at the mint; every rule below can be checked
   from the file alone.
4. **Signed votes**: a vote is accepted only if it is signed by one of its subject's minted keys, the subject hasn't
   voted before (no changing a vote), and its allocation fits the subject's weight.
5. **Table view** of the ledger, in the style of the confidential-ledger app: subjects, keys, weights, votes, hash
   links and totals, with a clear "Verified" / broken status.

## Non-goals (this version)

- Registration, credentials, OAuth, policies: all upstream.
- **Hiding allocations.** This version is plain text. Sealed allocations (Pedersen commitments, as in
  `confidential-ledger`) are a planned second layer; see "Leaving room for sealed allocations".
- Key rotation, multi-signature thresholds, changing or withdrawing a vote.
- Submitting votes over a network or relaying them anonymously. In the demo, the browser appends votes itself.
- Bringing in entries signed outside Tally (a KERI wallet, ssh-keygen). The app only explains how that would work.

## Anti-goals (failure even if it "works")

- Checking a file depends on trusting the host or a server.
- A private key ever ends up in `tally.json`.
- A broken or tampered file displays as if it were fine.

## Decisions made with Aaron

- Plain signed ledger first; sealed allocations later.
- Browser-held keys are enough for signing in this version, plus a small modal showing how to do it "for real"
  (generate a key with ssh-keygen, sign the entry's hash).
- The signed ledger **replaces** Tally's current simulated model: the voter list with attributes, weight rules,
  generated "Voter 0011…" keys, simulated leaves and hashes all go.
- Hashes are blake3 over canonical data, and each vote includes the previous entry's hash, giving a verifiable chain.
- Subjects are opaque strings (names in the demo, AIDs in practice).

## The ledger

A poll is an ordered list of entries: one **mint**, then zero or more **votes**, then optionally one **close**.

### Hashing: KERI SAIDs

Each entry carries its own hash in a `d` field and the previous entry's hash in `p`, using KERI's self-addressing
identifier (SAID) method, which already is "blake3-256 of the canonical data":

1. Serialize the entry as compact JSON with fields in the order listed below, **without its `sig` field**, and with
   `d` set to a placeholder of 44 `#` characters.
2. Take blake3-256 of those bytes and CESR-encode it (44 characters); that string is the SAID and goes in `d`.

Verifying is the same computation: recompute and compare. The mint's SAID is the **poll id**. Using SAIDs matches the
identifiers the real subjects already have. The builder should check the exact serialization and CESR codes against
the KERI/CESR specs and keep one test vector from a reference implementation.

### Mint (first entry)

```json
{ "v": "tally/1", "t": "mint", "d": "<SAID>",
  "title": "…", "desc": "…", "options": ["…", "…"], "quadratic": false,
  "organiser": { "id": "<AID or name>", "keys": ["<pubkey>"] },
  "subjects": [ { "id": "alice", "keys": ["<pubkey>", "…"], "weight": 4 }, … ],
  "total": 20, "dt": "<ISO-8601 time>",
  "sig": "<organiser signature over the entry with d filled in>" }
```

- Subject ids are unique; each subject has at least one key and a whole-number weight ≥ 1.
- `total` must equal the sum of the weights. That is the "sum of weights is constant" rule: the mint is the start of
  the chain and is identified by its own hash, so it can't change without changing the poll id.
- The organiser's signature makes the mint authentic, not just internally consistent. Trusting the organiser's key is
  out of band (for example a published AID).

### Vote

```json
{ "v": "tally/1", "t": "vote", "d": "<SAID>", "p": "<SAID of previous entry>",
  "subject": "alice", "alloc": { "0": 3, "2": 1 }, "dt": "<ISO-8601 time>",
  "key": "<which of alice's minted keys signed>", "sig": "<signature>" }
```

- `alloc` maps option positions to votes. Cost is the sum of the votes, or the sum of their squares if the mint says
  `quadratic`. Cost must be between 1 and the subject's weight. Spending less than the full weight is allowed (the
  rest abstains).

### Close (optional, last)

```json
{ "v": "tally/1", "t": "close", "d": "<SAID>", "p": "<SAID>", "dt": "…", "sig": "<organiser signature>" }
```

No votes may follow a close.

### Signatures

Ed25519, as KERI AIDs use. A signature covers the entry's serialized bytes with `d` filled in and the `sig` field
left out. Keys and signatures are CESR-encoded strings as KERI writes them. Any one of a subject's keys may sign.

### Verification rules (all checkable from the file)

1. Every entry's `d` is its correct SAID; every vote and close links to the entry before it through `p`.
2. The first entry is a mint, signed by its organiser; `total` equals the sum of the subjects' weights.
3. Each vote names a minted subject, is signed by one of that subject's keys, and is that subject's only vote.
4. Each vote's allocation names real options and costs no more than the subject's weight.
5. A close, if present, is last and signed by the organiser.
6. Derived: per-option totals, votes cast, weight used vs. minted total.

Verification reports **every** failure with the entry and the rule it broke. It never stops at the first one.

## The file

`tally.json` becomes `{ "polls": [ [mint, vote…, close?], … ], "drafts": [ … ] }`: one chain per minted poll, plus
unsigned drafts (title, description, options, quadratic, the subject rows so far). Drafts travel with Download and
`?src=` like everything else; minting moves a draft out of `drafts` and into `polls` as a new chain. (Builder's call:
one file per poll plus an index, if that turns out simpler.)

**Old files**: a clean break. The old format (voters, ballots, status) is not read. The browser storage key moves to a
new version, so returning visitors start empty rather than seeing an error, and the hosted example repo is
regenerated alongside the app release.

- **Reading**: malformed JSON or entries that don't match the shapes above are rejected with a path, as today.
  Well-formed files that **fail verification still load**, with the failures shown. Showing what's wrong is the point
  of a verifier.
- **Writing**: Tally only appends. Votes go at the end of a chain, and nothing already written is rewritten.
- `?src=`, Open, Download, saving in the browser, themes, the header and URL navigation keep working as they do now.

## The app after the change

- **Dashboard**: the same list of polls; status comes from the chain (draft / live / closed), and it shows whether
  each poll verifies.
- **Editor (drafts)**: title, description, options, quadratic on/off, and a **mint table** like confidential-ledger's
  "Mint New Ledger": rows of subject + weight (+ keys), a running total, and **Mint**. Minting signs the mint, fixes
  its SAID, and makes the poll live. A draft is not part of any chain and isn't written as one until it is minted.
  - Demo: Mint can generate an Ed25519 keypair for each subject that has no key.
  - Real use: paste the subject's AID and public key(s) instead.
- **Poll page**:
  - **Vote**: choose who you are from the subjects whose private keys this browser holds, allocate votes within
    that weight, sign, append.
  - **Ledger** (replaces Voters and the Merkle tree views): a confidential-ledger style table with one row per
    entry — kind, subject, allocation, weight, `p` → `d` hash link, signature status — then a per-option totals row
    and weight used out of the minted total. A **Verified** badge, or a list of failures linked to their rows. The badge always names who signed the mint
    ("Verified · minted by `<organiser id>` `<key>`"): the mint is signed by a key it lists itself, so the badge
    proves the file is intact and consistent, not who the organiser really is. Pinning an expected organiser is a
    possible later addition.
  - **Results**: per-option totals derived from the chain.
- **"Sign it for real" modal**: opened from the vote screen (and from Mint and Close). Signing in this version is
  browser-held only, so this is a how-to, not an import path. It shows:
  - the exact entry about to be signed: its canonical bytes (copy / download as `entry.json`) and its SAID;
  - a short shell script using standard tools: `ssh-keygen -t ed25519` to make a key, `ssh-keygen -Y sign -n tally`
    to sign the entry file, and `ssh-keygen -Y verify` with an allowed-signers file to check it;
  - a plain note that `ssh-keygen -Y` wraps the signature in SSH's own signature format, so bringing such a
    signature into Tally is a later step (Tally would then accept that format, or a raw Ed25519 signature made with
    `openssl pkeyutl -sign -rawin`).
- **Demo keyring**: private keys generated in this browser (the organiser's and the demo subjects') are kept in
  browser storage, **separately from `tally.json`**, and clearly labelled as demo keys. In real use, signing happens
  in the voter's KERI wallet.

## Leaving room for sealed allocations

Later, a vote's `alloc` can become one Pedersen commitment per option plus proofs (either/or proofs, or simple
bit-decomposition range proofs), as discussed. To keep that cheap:

- keep the `v` version field on every entry;
- keep the cost and tally logic in one place, so a sealed version can swap "add the numbers" for "add the
  commitments";
- keep the mint's subjects and weights public in both versions.

## Constraints

- Tally is a single no-build page (`Tally.dc.html` + `support.js`), served statically and tested with `bun test`.
  Crypto libraries must load in the browser without a build step and also run under Bun.
- Use `@noble/hashes` (blake3) and `@noble/curves` (ed25519), the same family confidential-ledger uses. (Note:
  confidential-ledger's `src/lib/ledger.ts` has a wrong curve-order constant in `modL`; don't copy it.)
- Must keep working from GitHub Pages and the data-only example repos.

## Left to the builder

- How the noble libraries are loaded (for example vendored, pinned ESM files beside the page, as `schedule/` vendors
  React).
- Exact table layout and wording; reuse Tally's existing tokens and themes.
- Whether the ballot card visuals survive in some form.
- The new example: regenerate `examples/harbor-commons/tally.json` as a real signed poll (its private keys can be
  thrown away once it is generated), and update `schema.md`, README and tests.

## Calls I made (Claude) for Aaron to check

1. KERI SAIDs as the hash format, rather than a home-made blake3-of-canonical-JSON.
2. The mint is signed by an organiser key, and an optional organiser-signed **close** entry ends a poll.
3. Spending less than your full weight is allowed; quadratic stays as a mint setting.
4. Any one of a subject's keys may sign (no thresholds).
5. **The Merkle tree views, the tamper demo, and the anonymous / show-weights poll settings are removed**, replaced
   by the chain table. Everything is public in this version.
6. Files that fail verification still load, with the failures shown; malformed files are rejected.
7. Demo private keys live in browser storage, never in `tally.json`.
8. Drafts are stored unsigned in `tally.json` under `drafts`.
9. Old-format files are a clean break: not read, new storage key, example repo regenerated.
10. The Verified badge names the organiser and key rather than implying they're authentic; no pinning yet.
11. The "sign it for real" modal uses ssh-keygen as asked, and says plainly that its signature format isn't accepted
    by Tally yet.
