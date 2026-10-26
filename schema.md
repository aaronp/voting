# tally.json format (v2)

A `tally.json` holds **signed polls** and **unsigned drafts**. Each poll is a chain of entries that anyone can check
from the file alone, without trusting whoever hosts it: the subjects and weights were fixed when the poll was minted,
and every vote was signed by a key allowed to vote, at most once per subject, within that subject's weight.

```json
{
  "polls": [
    [
      {
        "v": "tally/1",
        "t": "mint",
        "d": "EOKaKN4NVvCmeZhYTZjD28kJH4ycZalFLBuC7YClfhYX",
        "title": "What do we read next?",
        "desc": "",
        "options": [ "Piranesi", "Middlemarch" ],
        "quadratic": false,
        "organiser": { "id": "Book club", "keys": [ "DN8BWO_SeRMAnKW_qL5br3vKXMLEXwMF1h7VmODTkzFq" ] },
        "subjects": [
          { "id": "alice", "keys": [ "DNy5jOhgey5c3DahnjW_EszPK0qxanT8AkUhtF3IvLAU" ], "weight": 4 },
          { "id": "bob", "keys": [ "DIXI9ktaHJKYU5DwlGmK2yoQIM5zJwYV_zVn3CYCDJ3n" ], "weight": 8 }
        ],
        "total": 12,
        "dt": "2026-10-26T09:00:00.000Z",
        "sig": "0BAZqLu-cWhxSu1tq4C0hvcSVSngLFuZ5tOs8yyFZM1GwpGuIzoYAdSg38hNHj2YkPTMmVIO8cGMWve3VAfYlH8D"
      },
      {
        "v": "tally/1",
        "t": "vote",
        "d": "ENqlici5zJA57TfBPu5GtP7MB1sJSYC8YZBQVuiQkg9T",
        "p": "EOKaKN4NVvCmeZhYTZjD28kJH4ycZalFLBuC7YClfhYX",
        "subject": "alice",
        "alloc": { "0": 3, "1": 1 },
        "dt": "2026-10-26T09:05:00.000Z",
        "key": "DNy5jOhgey5c3DahnjW_EszPK0qxanT8AkUhtF3IvLAU",
        "sig": "0BAusZ4_61FFbM55rk-Q6CzdxDfRQYc0sGRvcKxLBXg-ERPeb5ybH8lzDrf6cOOaY-9tD0mURLuHcC78OxizG8kM"
      }
    ]
  ],
  "drafts": []
}
```

## The file

```json
{ "polls": [ [mint, vote…, close?], … ], "drafts": [ draft, … ] }
```

Reading is strict about shapes. Malformed JSON, missing or mistyped fields, unknown fields and unknown entry types are
rejected with their path, e.g. `polls[0][2].alloc.1: expected a whole number ≥ 0`. A well-formed chain that **fails
verification still loads**, and the app shows every failure. The old v1 format (voters, ballots) is not read.

## Entries

Every entry has `"v": "tally/1"`, its type `t`, its own hash `d` and a signature `sig`. Votes and the close also carry
`p`, the previous entry's `d`, which makes the poll a hash chain. The mint's `d` is the poll's id (`?poll=<d>`).

### mint (first entry)

| Field | Value |
| --- | --- |
| `title`, `desc` | Text |
| `options` | List of option labels |
| `quadratic` | `true`: n votes on one option cost n² |
| `organiser` | `{ "id": text, "keys": [Ed25519 key, …] }`. The mint is signed by one of these keys. |
| `subjects` | `[{ "id": text, "keys": [Ed25519 key, …], "weight": whole number ≥ 1 }]`. Ids are unique (AIDs in real use, names in the demo). |
| `total` | Must equal the sum of the weights |
| `dt` | ISO-8601 time |

### vote

| Field | Value |
| --- | --- |
| `p` | The previous entry's `d` |
| `subject` | A minted subject id |
| `alloc` | Votes per option, keyed by the option's position as text, e.g. `{ "0": 3, "2": 1 }` |
| `dt` | ISO-8601 time |
| `key` | Which of the subject's minted keys signed |

The cost is the sum of the votes, or the sum of their squares if the mint is `quadratic`. It must be between 1 and the
subject's weight; spending less than the full weight is allowed (the rest abstains).

### close (optional, last)

`p` and `dt`, signed by an organiser key. No votes may follow it.

## Hashes, keys and signatures

- **Canonical form**: the entry as compact JSON with its fields in the order listed below, `sig` left out, nested
  `organiser` as `id, keys`, each subject as `id, keys, weight`, and `alloc` keys in ascending numeric order. The order
  fields appear in the file doesn't matter.
  - mint: `v, t, d, title, desc, options, quadratic, organiser, subjects, total, dt`
  - vote: `v, t, d, p, subject, alloc, dt, key`
  - close: `v, t, d, p, dt`
- **SAID** (`d`): blake3-256 of the canonical form with `d` set to 44 `#` characters, CESR-encoded with code `E`
  (44 characters). This is KERI's self-addressing identifier.
- **Keys**: Ed25519 public keys, CESR code `D` (44 characters).
- **Signatures** (`sig`): Ed25519 over the canonical form with `d` filled in, CESR code `0B` (88 characters). Any one of
  the signer's listed keys may sign.

## Verification rules

`verify` checks every entry and reports all failures, each with its entry number and rule:

| Rule | Fails when |
| --- | --- |
| `first` | The chain doesn't start with a mint, or a later entry is a mint |
| `said` | An entry's `d` isn't the SAID of its contents |
| `link` | An entry's `p` isn't the previous entry's `d` |
| `mint-sig` | The mint or close isn't signed by an organiser key |
| `total` | `total` isn't the sum of the weights |
| `subject` | A vote names a subject that wasn't minted |
| `vote-sig` | A vote isn't signed by one of its subject's minted keys |
| `double` | A subject votes a second time |
| `options` | An allocation names an option that doesn't exist |
| `cost` | An allocation costs less than 1 or more than the subject's weight |
| `close` | An entry comes after the close |

Results count only votes that pass every rule. A failed vote still uses up its subject's one vote.

## Drafts

```json
{ "id": "neighborhood-fund", "title": "…", "desc": "", "options": ["…"], "quadratic": false,
  "organiser": "Harbor Commons board", "subjects": [{ "id": "alice", "keys": [], "weight": 4 }] }
```

Unsigned and editable. Only `id` and `title` are required; subjects may be incomplete while being edited. Minting checks
the draft, generates any missing keys (demo), signs the mint and moves it from `drafts` into `polls`.

## Private keys

Never in `tally.json`. In the demo, keys generated in the browser are kept in its storage (`tally:keys:v1`). In real
use, subjects sign with their own wallets; the app's "Sign it for real" window shows the exact bytes to sign.

## Complete example

`examples/harbor-commons/tally.json`: five polls (quadratic and plain, one closed) for ten subjects, and one draft.
Regenerate it with `make example` (fresh keys each time; the private keys are discarded).
