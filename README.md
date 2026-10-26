# Tally

**[▶ Open Tally](https://aaronp.github.io/voting/)** ·
[Harbor Commons example](https://aaronp.github.io/voting/?src=examples/harbor-commons/tally.json)

Weighted, verifiable polls driven by **one JSON file**: voters, polls and ballots. Every ballot is a leaf in a
Merkle tree you can inspect and tamper with to see the root change. This repo is the app. Your polls can live in
their own repo and be loaded with `?src=` (see [Publishing your own polls](#publishing-your-own-polls)).

- **Dashboard**: every poll, filtered by what needs your vote.
- **Poll**: vote (plain or quadratic), see who voted, and explore the ledger as a tree, fisheye, carousel or radial view.
- **Editor**: draft a poll, set token weights per voter attribute, publish it.
- **Open…**: drop a `.json` file, choose one, or open one from a URL (GitHub file links work). **Download** saves the polls as `tally.json`.
- Four themes: Graph paper, Night shift, Blueprint and Warm ledger.

Changes are saved in the browser (localStorage). **The downloaded `tally.json` is the real copy**, so keep it in git.

## Addresses

The address bar always shows where you are, so any view can be bookmarked or shared, and Back works.

| Query | Shows |
| --- | --- |
| _(none)_ | The dashboard: the polls saved in this browser, or none on a first visit |
| `?filter=todo\|voted\|drafts`, `?q=`, `?sort=votes` | The dashboard, filtered, searched or sorted |
| `?poll=<id>` | A poll. Add `&tab=voters` or `&tab=ledger` |
| `?poll=<id>&tab=ledger&layout=fisheye&group=4` | The ledger as `tree` (default), `fisheye`, `carousel` or `radial`, rolling up `2`, `4`, `10` (default) or `16` per group |
| `?edit=<id>` | The editor for a draft |
| `?src=<url>` | That JSON file (absolute, or relative to the page). It isn't autosaved, so it never overwrites your saved polls. |
| `?theme=` | `paper` (default), `night`, `blueprint` or `warm`. This wins over the theme saved in the browser. |

Files on another host must allow CORS (GitHub Pages and raw.githubusercontent.com both do).

## The file format

The full format is in **[schema.md](schema.md)**.

```json
{
  "title": "Book club",
  "voters": [{ "name": "Sam Rivera" }, { "name": "Maya Chen" }],
  "polls": [
    { "id": "next-book", "status": "live", "title": "What do we read next?", "options": ["Piranesi", "Middlemarch"],
      "ballots": [{ "voter": 1, "alloc": { "0": 1 } }] }
  ]
}
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
make test    # bun test: reading and writing tally.json, the address bar, opening and saving
```

| Path | What |
| --- | --- |
| `Tally.dc.html` | The app: an `<x-dc>` template plus its logic class (file format, ballots and Merkle tree, view model) |
| `BallotCard.dc.html` | The flippable ballot card used in the ledger |
| `support.js` | The runtime that renders the templates in a browser (loads React from a CDN) |
| `schema.md` | The JSON format |
| `examples/harbor-commons/` | A cloneable data-only repo that points back at this app. A test checks its `tally.json` reads and writes back unchanged. |
| `app.test.ts` | Runs the logic class with the browser stubbed out |
