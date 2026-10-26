# tally.json format

All the polls live in **one JSON file**. The app reads it, and every change made in the UI (voting, editing
drafts, publishing) writes it back. Reading is strict: anything wrong is reported with its path, e.g.
`polls[2].ballots[0].voter: this poll is open to keys 0–9`, and the app keeps what it had.

## Minimal example

```json
{
  "title": "Book club",
  "voters": [{ "name": "Sam Rivera" }, { "name": "Maya Chen" }],
  "polls": [
    {
      "id": "next-book",
      "status": "live",
      "title": "What do we read next?",
      "options": ["Piranesi", "Middlemarch"],
      "ballots": [{ "voter": 1, "alloc": { "0": 1 } }]
    }
  ]
}
```

## Top level

| Key | Value | Required |
| --- | --- | --- |
| `title` | Shown as the dashboard heading | No |
| `attributes` | `[{ "key": "near", "label": "Lives within 1 mile" }]`: facts about voters that weight rules can use. Keys are unique. | No |
| `voters` | The listed public keys. **The first voter is you**: the one who votes in the UI. | Yes, at least one |
| `polls` | The polls, in any order | Yes |

### Voters

```json
{ "name": "Maya Chen", "attrs": ["near", "stake"] }
```

`name` is unique; the voter's public key is derived from it. `attrs` (optional) must be keys from `attributes`.
Ballots refer to voters by their position in this list, starting at 0.

## Polls

| Key | Value | Default |
| --- | --- | --- |
| `id` | Unique, non-empty. Used in the address: `?poll=<id>` | required |
| `status` | `"draft"`, `"live"` or `"closed"` | required |
| `title` | Text | required |
| `options` | List of option labels. Live and closed polls need at least two. | required |
| `desc` | Text under the title | `""` |
| `anonymous` | `true` hides voter identities | `false` |
| `showWeights` | `true` shows everyone's token allocation | `false` |
| `quadratic` | `true`: n votes on one option cost n² tokens | `false` |
| `base` | Tokens every eligible key gets (≥ 1) | `1` |
| `rules` | `[{ "attr": "near", "tokens": 8 }]`: extra tokens for voters with that attribute | `[]` |
| `closes` | Free text, e.g. `"Closes in 2 days"` | `""` |
| `created` | A number; the dashboard's "Newest" sort uses it | the poll's position |
| `eligible` | How many keys can vote: the first `eligible` voters. If that is more than the listed voters, the rest are generated (`Voter 0011`, …) so large polls need no list | the number of voters |
| `ballots` | The votes, in ledger order | `[]` |

### Ballots

```json
{ "voter": 3, "alloc": { "0": 2, "2": 1 } }
```

- `voter`: a voter's position (0 is you), below the poll's `eligible`. Each voter votes at most once per poll.
- `alloc`: votes per option, keyed by the option's position as text. The cost (votes, or votes² when
  `quadratic`) can't exceed the voter's tokens (`base` plus their matching `rules`).

Only who voted and how is stored. Each ballot's leaf (salt, commitment, vote token, signature) and the Merkle root are
derived from it when the file is read, so the ledger always matches the file.

## How the app writes the file

Download (or the browser's saved copy) writes every poll key above in the order listed, with short lists and each
ballot on one line. `parse(serialize(doc))` gives back the same document.

## Complete example

`examples/harbor-commons/tally.json` uses everything: attributes, weight rules, quadratic and anonymous polls,
drafts, and a closed poll open to 1,300 keys.
