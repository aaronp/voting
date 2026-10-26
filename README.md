# Tally

**[▶ Open Tally](https://aaronp.github.io/voting/)** ·
[Harbor Commons example](https://aaronp.github.io/voting/?src=examples/harbor-commons/tally.json)

Weighted polls you can check yourself, driven by **one JSON file**. A poll starts with a signed **mint** that fixes
its subjects, their keys and their weights; each vote is signed by a subject's key and chained to the entry before it by
its blake3 hash (a KERI SAID). Anyone holding `tally.json` can verify all of it offline, without trusting whoever hosts
it. This repo is the app. Your polls can live in their own repo and be loaded with `?src=` (see
[Publishing your own polls](#publishing-your-own-polls)).

- **Dashboard**: every poll and draft, with whether it verifies, filtered by what needs your vote.
- **Editor**: draft a poll and fill in the mint table (subject, weight, public keys), then **Mint** to fix it.
- **Poll**: vote as any subject whose key this browser holds (plain or quadratic), see the **Results**, and read the
  **Ledger**: the subjects, every entry with its hash link and signature check, the totals, and a **Verified** badge or
  a list of what's broken.
- **Sign it for real…**: shows the exact bytes an entry signs and how to sign them with `ssh-keygen`, outside Tally.
- **Open…**: drop a `.json` file, choose one, or open one from a URL (GitHub file links work). **Download** saves `tally.json`.
- Four themes: Graph paper, Night shift, Blueprint and Warm ledger.

Changes are saved in the browser (localStorage). **The downloaded `tally.json` is the real copy**, so keep it in git.
Private keys generated for the demo stay in this browser's storage, never in `tally.json`; the header shows how many
it holds. The "Verified" badge proves a file is intact and consistent, not who its organiser really is.

## Addresses

The address bar always shows where you are, so any view can be bookmarked or shared, and Back works.

| Query | Shows |
| --- | --- |
| _(none)_ | The dashboard: the polls saved in this browser, or none on a first visit |
| `?filter=todo\|voted\|drafts`, `?q=`, `?sort=votes` | The dashboard, filtered, searched or sorted |
| `?filter=closed` | Also: closed polls |
| `?poll=<id>` | A poll, by its mint's SAID. Add `&tab=ledger` or `&tab=results` |
| `?edit=<id>` | The editor for a draft |
| `?src=<url>` | That JSON file (absolute, or relative to the page). It isn't autosaved, so it never overwrites your saved polls. |
| `?theme=` | `paper` (default), `night`, `blueprint` or `warm`. This wins over the theme saved in the browser. |

Files on another host must allow CORS (GitHub Pages and raw.githubusercontent.com both do).

## The file format

The full format is in **[schema.md](schema.md)**.

```json
{ "polls": [ [ { "t": "mint", … }, { "t": "vote", "subject": "alice", "alloc": { "0": 3 }, "p": "<previous d>", "sig": "0B…", … } ] ],
  "drafts": [ … ] }
```

## Viewing locally

```sh
make dev     # serves with Bun on http://localhost:8000/ and prints the example's URL
```

The app (`Tally.dc.html`) is served at `/`, with the rest of the repo beside it as on GitHub Pages, so
`http://localhost:8000/?src=examples/harbor-commons/tally.json` works.

## Hosting

`.github/workflows/pages.yml` runs the tests on pushes to `main` or `master`, then publishes the app as
`index.html` with `examples/` beside it. Set Settings → Pages → Source: **GitHub Actions**; the
`github-pages` environment must allow your branch. `.json` files are served raw, without Jekyll.

## Publishing your own polls

Your polls live in their own data-only repo (`tally.json`, a redirecting `index.html` and a Pages workflow), and
this repo stays the app. Create an empty repo on GitHub, then:

```sh
git clone https://github.com/aaronp/voting.git
cd voting/examples/harbor-commons
make clone REPO=you/your-polls    # or ./clone.sh to be prompted
```

This copies the example to `../your-polls` as a fresh repo on `main`, points its README link at
`https://you.github.io/your-polls/` and sets the `origin` remote. Edit `tally.json`, commit and
`git push -u origin main`, then set Settings → Pages → Source: **GitHub Actions**.

## Development

```sh
make test     # bun test: the ledger (hashes, signatures, verification, file format) and the app
make example  # regenerate the example with fresh keys
make vendor   # rebuild vendor/noble.js from the pinned @noble packages
```

| Path | What |
| --- | --- |
| `Tally.dc.html` | The app: an `<x-dc>` template plus its logic class (state, keyring, view model) |
| `ledger.js` | The ledger, with no DOM: CESR, canonical form, SAIDs, signatures, entries, `verify`, the file format |
| `vendor/noble.js` | blake3 and ed25519 from `@noble/hashes` and `@noble/curves` 2.0.1, bundled by `make vendor` |
| `support.js` | The runtime that renders the template in a browser (loads React from a CDN) |
| `schema.md` | The file format and verification rules |
| `examples/harbor-commons/` | A cloneable data-only repo that points back at this app, with real signed polls (`make example`) |
| `scripts/make-example.ts` | Generates that example |
| `ledger.test.ts` | Tests for `ledger.js` |
| `app.test.ts` | Runs the logic class with the browser stubbed out and the real ledger behind it |
