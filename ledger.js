// The signed vote ledger: a poll is a chain of entries (mint, votes, close) that anyone can verify from the file
// alone. No DOM here; Tally.dc.html loads this module as window.TallyLedger and the tests import it directly.
import { blake3, ed25519, hkdf, ristretto255, ristretto255_hasher, sha256, x25519 } from './vendor/noble.js';

// ---- CESR ----
// Codes from the CESR master code table (ToIP CESR spec): C = X25519 public encryption key, D = Ed25519 verification
// key, E = Blake3-256 digest (1-char codes over 32 bytes, 44 chars), 0B = Ed25519 signature (2-char code over 64 bytes, 88 chars).
const SIZES = { C: 32, D: 32, E: 32, '0B': 64 };
const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

export function cesrEncode(code, raw) {
  if (SIZES[code] !== raw.length) throw new Error('CESR ' + code + ' needs ' + SIZES[code] + ' bytes');
  const padded = new Uint8Array(code.length + raw.length); padded.set(raw, code.length);
  return code + b64u(padded).slice(code.length);
}
export function cesrDecode(s) {
  const code = s[0] === '0' ? s.slice(0, 2) : s[0], size = SIZES[code];
  if (!size || s.length !== Math.ceil((size + code.length) / 3) * 4) throw new Error('not a CESR ' + Object.keys(SIZES).join('/') + ' value');
  const raw = unb64u('A'.repeat(code.length) + s.slice(code.length)).slice(code.length);
  if (raw.length !== size) throw new Error('not a CESR ' + code + ' value');
  return { code, raw };
}

// ---- Canonical form and SAIDs ----
// The field order that hashes and signatures use, whatever order a file lists them in. sig is never part of it.
export const FIELDS = {
  mint: ['v', 't', 'd', 'title', 'desc', 'options', 'quadratic', 'kind', 'organiser', 'subjects', 'total', 'dt'],
  vote: ['v', 't', 'd', 'p', 'subject', 'alloc', 'seals', 'opening', 'dt', 'key'],
  close: ['v', 't', 'd', 'p', 'root', 'group', 'dt'],
  tally: ['v', 't', 'd', 'p', 'totals', 'blinds', 'used', 'excluded', 'root', 'group', 'dt']
};
const ordered = (k, v) =>
  k === 'organiser' ? { id: v.id, keys: v.keys, ...(v.enc !== undefined ? { enc: v.enc } : {}) } :
  k === 'excluded' ? v.map(x => ({ index: x.index, reason: x.reason })) :
  k === 'subjects' ? v.map(s => ({ id: s.id, keys: s.keys, weight: s.weight })) :
  k === 'alloc' ? Object.fromEntries(Object.keys(v).sort((a, b) => a - b).map(o => [o, v[o]])) : v;

export function canonical(entry) {
  const fields = FIELDS[entry.t];
  if (!fields) throw new Error('unknown entry type "' + entry.t + '"');
  return JSON.stringify(Object.fromEntries(fields.filter(k => k in entry).map(k => [k, ordered(k, entry[k])])));
}
const utf8 = s => new TextEncoder().encode(s);
export const said = entry => cesrEncode('E', blake3(utf8(canonical({ ...entry, d: '#'.repeat(44) }))));

// ---- Keys and signatures ----
export function newKeypair() {
  const { secretKey, publicKey } = ed25519.keygen();
  return { pub: cesrEncode('D', publicKey), secret: b64u(secretKey) };
}
export const sign = (entry, secret) => cesrEncode('0B', ed25519.sign(utf8(canonical(entry)), unb64u(secret)));
export function verifySig(entry, pub, sig) {
  try {
    const k = cesrDecode(pub), s = cesrDecode(sig);
    return k.code === 'D' && s.code === '0B' && ed25519.verify(s.raw, utf8(canonical(entry)), k.raw);
  } catch (e) { return false; }
}

// ---- Seals (Pedersen commitments) and encrypted openings ----
// A seal is G·v + H·r on ristretto255, hex-encoded; seals add up, so the sum of the counted seals must equal the seal of
// the published total. G and H are the generators confidential-ledger uses.
export const L_ORDER = 2n ** 252n + 27742317777372353535851937790883648493n;
const G = ristretto255.Point.BASE, H = ristretto255_hasher.hashToCurve(utf8('conf-ledger:H:v1')), ZERO = ristretto255.Point.ZERO;
const mod = n => ((n % L_ORDER) + L_ORDER) % L_ORDER;
const toHex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const fromHex = h => Uint8Array.from(h.match(/../g) || [], x => parseInt(x, 16));
const times = (P, n) => (n === 0n ? ZERO : P.multiply(n));
export const seal = (v, r) => toHex(times(G, mod(BigInt(v))).add(times(H, mod(BigInt(r)))).toBytes());
export const addSeals = hexes => toHex(hexes.reduce((sum, h) => sum.add(ristretto255.Point.fromBytes(fromHex(h))), ZERO).toBytes());
// 64 random bytes reduced mod the group order, so the blind is uniform.
export const randomBlind = () => mod(BigInt('0x' + toHex(crypto.getRandomValues(new Uint8Array(64)))));

export function newEncKeypair() {
  const { secretKey, publicKey } = x25519.keygen();
  return { pub: cesrEncode('C', publicKey), secret: b64u(secretKey) };
}
// ECIES: X25519 with a fresh ephemeral key, HKDF-SHA256, AES-GCM. Payload = base64url(ephemeral pub ‖ nonce ‖ ciphertext).
const aesKey = async (shared, use) => crypto.subtle.importKey('raw', hkdf(sha256, shared, utf8('tally/1'), utf8('opening'), 32), 'AES-GCM', false, [use]);
export async function encrypt(pub, text) {
  const eph = x25519.keygen(), nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(x25519.getSharedSecret(eph.secretKey, cesrDecode(pub).raw), 'encrypt');
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, utf8(text)));
  const out = new Uint8Array(32 + 12 + ct.length); out.set(eph.publicKey, 0); out.set(nonce, 32); out.set(ct, 44);
  return b64u(out);
}
export async function decrypt(secret, payload) {
  const bytes = unb64u(payload), key = await aesKey(x25519.getSharedSecret(unb64u(secret), bytes.slice(0, 32)), 'decrypt');
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(32, 44) }, key, bytes.slice(44)));
}

// ---- Merkle tree ----
// Leaves (entry SAIDs) roll up k at a time; each node is the blake3 SAID-style hash of its children joined.
// A short last group hashes what it has, and even a single leaf gets a parent, so there is always a root above the leaves.
export const ROOT_GROUP = 10;
export function merkle(leaves, k) {
  const levels = [leaves];
  do {
    const lvl = levels[levels.length - 1], up = [];
    for (let i = 0; i < lvl.length; i += k) up.push(cesrEncode('E', blake3(utf8(lvl.slice(i, i + k).join('')))));
    levels.push(up);
  } while (levels[levels.length - 1].length > 1);
  return levels;
}
const top = levels => levels[levels.length - 1][0];
export const rootOf = (chain, k = ROOT_GROUP) => top(merkle(chain.map(e => e.d), k));

// ---- Entries ----
const V = 'tally/1';
const sealed = (entry, secret) => { entry.d = said(entry); entry.sig = sign(entry, secret); return entry; };

export const cost = (alloc, quadratic) => Object.values(alloc).reduce((s, k) => s + (quadratic ? k * k : k), 0);

export function makeMint({ title, desc, options, quadratic, kind, organiser, subjects, dt }, organiserSecret) {
  return sealed({ v: V, t: 'mint', d: '', title, desc, options, quadratic, ...(kind === 'sealed' ? { kind } : {}), organiser, subjects,
    total: subjects.reduce((s, x) => s + x.weight, 0), dt }, organiserSecret);
}
export function makeVote(chain, { subject, alloc, key, dt }, secret) {
  return sealed({ v: V, t: 'vote', d: '', p: chain[chain.length - 1].d, subject, alloc, dt, key }, secret);
}
// A sealed vote carries one seal per option and its opening encrypted to the organiser; the voter keeps the opening too.
export async function makeSealedVote(chain, { subject, alloc, key, dt }, secret) {
  const mint = chain[0], values = mint.options.map((_, i) => alloc[i] || 0), blinds = values.map(() => randomBlind());
  const opening = { values, blinds: blinds.map(String) };
  const entry = sealed({ v: V, t: 'vote', d: '', p: chain[chain.length - 1].d, subject, seals: values.map((v, i) => seal(v, blinds[i])),
    opening: await encrypt(mint.organiser.enc, JSON.stringify(opening)), dt, key }, secret);
  return { entry, opening };
}
export function makeClose(chain, dt, organiserSecret) {
  return sealed({ v: V, t: 'close', d: '', p: chain[chain.length - 1].d, root: rootOf(chain), group: ROOT_GROUP, dt }, organiserSecret);
}
// The organiser opens every sealed ballot, counts the ones that open to a valid allocation, and publishes per-option
// totals with the matching sums of blinds, so anyone can check them against the seals. It closes the poll.
export async function makeTally(chain, { secret, encSecret }, dt) {
  const mint = chain[0], v = verify(chain), n = mint.options.length, totals = Array(n).fill(0), blinds = Array(n).fill(0n), excluded = [];
  let used = 0;
  for (let i = 1; i < chain.length; i++) {
    const e = chain[i];
    if (e.t !== 'vote' || v.failures.some(f => f.index === i)) continue;
    const no = reason => excluded.push({ index: i, reason });
    let o; try { o = JSON.parse(await decrypt(encSecret, e.opening)); } catch (err) { no('does not open'); continue; }
    const vals = o && Array.isArray(o.values) ? o.values : [], bl = o && Array.isArray(o.blinds) ? o.blinds : [];
    if (vals.length !== n || bl.length !== n || !vals.every(x => Number.isSafeInteger(x) && x >= 0) || !bl.every(x => /^\d+$/.test(x))) { no('opening is malformed'); continue; }
    if (vals.some((x, k) => seal(x, BigInt(bl[k])) !== e.seals[k])) { no("seals don't match"); continue; }
    const c = cost(Object.assign({}, vals), mint.quadratic), w = mint.subjects.find(s => s.id === e.subject).weight;
    if (c < 1 || c > w) { no('costs ' + c + ', holds ' + w); continue; }
    vals.forEach((x, k) => { totals[k] += x; blinds[k] = mod(blinds[k] + BigInt(bl[k])); }); used += c;
  }
  return sealed({ v: V, t: 'tally', d: '', p: chain[chain.length - 1].d, totals, blinds: blinds.map(String), used, excluded,
    root: rootOf(chain), group: ROOT_GROUP, dt }, secret);
}

// ---- Verification ----
// Checks every rule on every entry and reports all failures; it never stops at the first. Only votes that pass every
// rule count, but a failed vote still uses up its subject's one vote. In a sealed poll nothing is counted until the
// tally, whose totals must equal the sum of the seals of the ballots it counted.
export function verify(chain) {
  const failures = [], fail = (index, rule, message) => failures.push({ index, rule, message });
  const mint = chain[0] && chain[0].t === 'mint' ? chain[0] : null, sealedPoll = !!mint && mint.kind === 'sealed';
  let totals = mint ? mint.options.map(() => 0) : [], used = 0, endedAt = -1;
  const voted = {}, valid = [];
  chain.forEach((e, i) => {
    if (e.d !== said(e)) fail(i, 'said', 'its hash (d) does not match its contents');
    if (i > 0 && e.p !== chain[i - 1].d) fail(i, 'link', 'it does not point at the entry before it (p)');
  });
  if (!mint) { fail(0, 'first', 'a poll must start with a mint'); return { ok: false, failures, status: 'live', totals, voted, used, total: 0, sealed: false }; }
  const signedBy = (e, keys) => keys.some(k => verifySig(e, k, e.sig));
  if (!signedBy(mint, mint.organiser.keys)) fail(0, 'mint-sig', 'not signed by an organiser key');
  const sum = mint.subjects.reduce((s, x) => s + x.weight, 0);
  if (sum !== mint.total) fail(0, 'total', 'total is ' + mint.total + ' but the weights add up to ' + sum);
  if (sealedPoll && !mint.organiser.enc) fail(0, 'mint-sig', 'a sealed poll needs an organiser encryption key (enc)');
  chain.forEach((e, i) => {
    if (i === 0) return;
    if (e.t === 'mint') { fail(i, 'first', 'only the first entry can be a mint'); return; }
    if (endedAt >= 0) fail(i, 'close', 'comes after the poll ended (entry #' + endedAt + ')');
    if (e.root !== undefined && e.root !== rootOf(chain.slice(0, i), e.group)) fail(i, 'root', 'its signed root does not match the tree of the entries before it');
    if (e.t === 'close' || e.t === 'tally') {
      if (!signedBy(e, mint.organiser.keys)) fail(i, 'mint-sig', e.t + ' not signed by an organiser key');
      if (e.t === 'close' && sealedPoll) fail(i, 'close', 'a sealed poll ends with its tally, not a close');
      if (e.t === 'tally' && !sealedPoll) fail(i, 'close', 'only a sealed poll has a tally');
      if (e.t === 'tally' && sealedPoll) {
        const out = new Set(e.excluded.map(x => x.index)), counted = valid.filter(j => !out.has(j));
        const bad = mint.options.map((_, k) => k).filter(k => e.totals[k] === undefined || e.blinds[k] === undefined || !/^\d+$/.test(e.blinds[k])
          || addSeals(counted.map(j => chain[j].seals[k])) !== seal(e.totals[k], BigInt(e.blinds[k])));
        if (e.totals.length !== mint.options.length || bad.length) fail(i, 'tally', 'its totals do not match the sealed ballots it counted' + (bad.length ? ' (option ' + bad.join(', ') + ')' : ''));
        else { totals = e.totals.slice(); used = e.used; }
      }
      endedAt = i; return;
    }
    const before = failures.length, s = mint.subjects.find(x => x.id === e.subject);
    if (!s) fail(i, 'subject', '"' + e.subject + '" is not a minted subject');
    else if (!s.keys.includes(e.key) || !verifySig(e, e.key, e.sig)) fail(i, 'vote-sig', 'not signed by one of ' + e.subject + "'s keys");
    if (Object.prototype.hasOwnProperty.call(voted, e.subject)) fail(i, 'double', e.subject + ' already voted (entry #' + voted[e.subject] + ')');
    else voted[e.subject] = i;
    if (sealedPoll) {
      if (e.alloc !== undefined || !Array.isArray(e.seals) || e.seals.length !== mint.options.length || typeof e.opening !== 'string')
        fail(i, 'options', 'a sealed vote needs one seal per option and an encrypted opening, and no plain allocation');
      else if (!e.seals.every(x => /^[0-9a-f]{64}$/.test(x))) fail(i, 'options', 'a seal is not a valid point');
      if (failures.length === before) valid.push(i);
      return;
    }
    if (e.alloc === undefined || e.seals !== undefined) { fail(i, 'options', 'an open vote needs a plain allocation'); return; }
    const badOpt = Object.keys(e.alloc).filter(o => !/^(0|[1-9]\d*)$/.test(o) || Number(o) >= mint.options.length);
    if (badOpt.length) fail(i, 'options', 'no option ' + badOpt.join(', '));
    const c = cost(e.alloc, mint.quadratic);
    if (s && (c < 1 || c > s.weight)) fail(i, 'cost', 'costs ' + c + ' but ' + e.subject + ' holds ' + s.weight);
    if (failures.length === before) { Object.entries(e.alloc).forEach(([o, k]) => { totals[o] += k; }); used += c; }
  });
  return { ok: failures.length === 0, failures, status: endedAt >= 0 ? 'closed' : 'live', totals, voted, used, total: mint.total, sealed: sealedPoll };
}

// ---- The file ----
// tally.json is { polls: [[mint, vote…, close?], …], drafts: [...] }. Reading checks shapes only (throwing with a path,
// e.g. "polls[0][2].alloc.1: expected a whole number ≥ 0"); whether a chain verifies is verify()'s job.
export function parseFile(text) {
  let d; try { d = JSON.parse(text); } catch (e) { throw new Error('Not valid JSON: ' + e.message); }
  const fail = (path, msg) => { throw new Error(path + ': ' + msg); };
  const obj = (v, path) => v !== null && typeof v === 'object' && !Array.isArray(v) ? v : fail(path, 'expected an object');
  const list = (v, path, each) => (Array.isArray(v) ? v : fail(path, 'expected a list')).map((x, i) => each(x, path + '[' + i + ']'));
  const str = (v, path) => typeof v === 'string' ? v : fail(path, 'expected text');
  const bool = (v, path) => typeof v === 'boolean' ? v : fail(path, 'expected true or false');
  const int = min => (v, path) => Number.isInteger(v) && v >= min ? v : fail(path, 'expected a whole number ≥ ' + min);
  // Checks o has exactly the given fields (each with its checker) and returns them in that order.
  const shape = (o, path, spec, defaults = {}) => {
    obj(o, path);
    Object.keys(o).forEach(k => { if (!(k in spec)) fail(path + '.' + k, 'unknown field'); });
    // A default of undefined marks an optional field that is left out when absent.
    return Object.fromEntries(Object.entries(spec).filter(([k]) => !(o[k] === undefined && k in defaults && defaults[k] === undefined))
      .map(([k, check]) => [k, o[k] === undefined && k in defaults ? defaults[k] : check(o[k], path + '.' + k)]));
  };
  const strs = (v, path) => list(v, path, str);
  const some = check => (v, path) => { const out = check(v, path); return out.length ? out : fail(path, 'needs at least one'); };
  // A mint needs subjects, each with a key and a weight ≥ 1; a draft can be incomplete.
  const subjects = min => (v, path) => {
    const out = (min ? some : x => x)((v2, p2) => list(v2, p2, (s, p) => shape(s, p, { id: str, keys: min ? some(strs) : strs, weight: int(min) }, min ? {} : { keys: [], weight: 1 })))(v, path);
    // Drafts are saved while being typed, so only a mint insists on unique ids.
    if (min) out.forEach((s, i) => { if (out.findIndex(x => x.id === s.id) !== i) fail(path + '[' + i + '].id', 'duplicate subject "' + s.id + '"'); });
    return out;
  };
  const alloc = (v, path) => Object.fromEntries(Object.entries(obj(v, path)).map(([k, n]) => [k, int(0)(n, path + '.' + k)]));
  const version = (v, path) => v === 'tally/1' ? v : fail(path, 'unsupported version (expected "tally/1")');
  const ENTRY = {
    mint: { v: version, t: str, d: str, title: str, desc: str, options: strs, quadratic: bool, kind: (v, p) => v === 'open' || v === 'sealed' ? v : fail(p, 'expected "open" or "sealed"'),
      organiser: (v, p) => shape(v, p, { id: str, keys: strs, enc: str }, { enc: undefined }), subjects: subjects(1), total: int(0), dt: str, sig: str },
    vote: { v: version, t: str, d: str, p: str, subject: str, alloc, seals: strs, opening: str, dt: str, key: str, sig: str },
    tally: { v: version, t: str, d: str, p: str, totals: (v, p) => list(v, p, int(0)), blinds: strs, used: int(0),
      excluded: (v, p) => list(v, p, (x, q) => shape(x, q, { index: int(0), reason: str })), root: str, group: int(2), dt: str, sig: str },
    close: { v: version, t: str, d: str, p: str, root: str, group: int(2), dt: str, sig: str }
  };
  const OPTIONAL = { mint: { kind: undefined }, vote: { alloc: undefined, seals: undefined, opening: undefined }, close: { root: undefined, group: undefined } };
  const entry = (e, path) => { obj(e, path); return ENTRY[e.t] ? shape(e, path, ENTRY[e.t], OPTIONAL[e.t]) : fail(path + '.t', 'expected "mint", "vote", "close" or "tally"'); };
  obj(d, 'file');
  const polls = list(d.polls, 'polls', (chain, p) => list(chain, p, entry));
  polls.forEach((c, i) => { if (c.length && polls.findIndex(x => x.length && x[0].d === c[0].d) !== i) fail('polls[' + i + '][0].d', 'duplicate poll'); });
  const drafts = d.drafts === undefined ? [] : list(d.drafts, 'drafts', (x, p) => shape(x, p,
    { id: str, title: str, desc: str, options: strs, quadratic: bool, organiser: str, subjects: subjects(0) },
    { desc: '', options: [], quadratic: false, organiser: 'Organiser', subjects: [] }));
  Object.keys(d).forEach(k => { if (k !== 'polls' && k !== 'drafts') fail(k, 'unknown field'); });
  return { polls, drafts };
}
// Pretty JSON, with short lists and objects (options, keys, allocations) kept on one line.
export function serializeFile(doc) {
  let s = JSON.stringify(doc, null, 2);
  for (let pass = 0; pass < 3; pass++) s = s.replace(/[\[{](?:[^\[\]{}]|\{[^{}\[\]\n]*\}|\[[^{}\[\]\n]*\])*[\]}]/g, m => { const one = m.replace(/\s*\n\s*/g, ' '); return one.length <= 100 ? one : m; });
  return s + '\n';
}
