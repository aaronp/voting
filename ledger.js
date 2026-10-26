// The signed vote ledger: a poll is a chain of entries (mint, votes, close) that anyone can verify from the file
// alone. No DOM here; Tally.dc.html loads this module as window.TallyLedger and the tests import it directly.
import { blake3, ed25519 } from './vendor/noble.js';

// ---- CESR ----
// Codes from the CESR master code table (ToIP CESR spec): D = Ed25519 verification key, E = Blake3-256 digest
// (both 1-char codes over 32 bytes, 44 chars), 0B = Ed25519 signature (2-char code over 64 bytes, 88 chars).
const SIZES = { D: 32, E: 32, '0B': 64 };
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
  mint: ['v', 't', 'd', 'title', 'desc', 'options', 'quadratic', 'organiser', 'subjects', 'total', 'dt'],
  vote: ['v', 't', 'd', 'p', 'subject', 'alloc', 'dt', 'key'],
  close: ['v', 't', 'd', 'p', 'dt']
};
const ordered = (k, v) =>
  k === 'organiser' ? { id: v.id, keys: v.keys } :
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

// ---- Entries ----
const V = 'tally/1';
const sealed = (entry, secret) => { entry.d = said(entry); entry.sig = sign(entry, secret); return entry; };

export const cost = (alloc, quadratic) => Object.values(alloc).reduce((s, k) => s + (quadratic ? k * k : k), 0);

export function makeMint({ title, desc, options, quadratic, organiser, subjects, dt }, organiserSecret) {
  return sealed({ v: V, t: 'mint', d: '', title, desc, options, quadratic, organiser, subjects,
    total: subjects.reduce((s, x) => s + x.weight, 0), dt }, organiserSecret);
}
export function makeVote(chain, { subject, alloc, key, dt }, secret) {
  return sealed({ v: V, t: 'vote', d: '', p: chain[chain.length - 1].d, subject, alloc, dt, key }, secret);
}
export function makeClose(chain, dt, organiserSecret) {
  return sealed({ v: V, t: 'close', d: '', p: chain[chain.length - 1].d, dt }, organiserSecret);
}

// ---- Verification ----
// Checks every rule on every entry and reports all failures; it never stops at the first. Only votes that pass every
// rule count towards totals and used weight, but a failed vote still uses up its subject's one vote.
export function verify(chain) {
  const failures = [], fail = (index, rule, message) => failures.push({ index, rule, message });
  const mint = chain[0] && chain[0].t === 'mint' ? chain[0] : null;
  const totals = mint ? mint.options.map(() => 0) : [], voted = {};
  let used = 0, closedAt = -1;
  chain.forEach((e, i) => {
    if (e.d !== said(e)) fail(i, 'said', 'its hash (d) does not match its contents');
    if (i > 0 && e.p !== chain[i - 1].d) fail(i, 'link', 'it does not point at the entry before it (p)');
  });
  if (!mint) { fail(0, 'first', 'a poll must start with a mint'); return { ok: false, failures, status: 'live', totals, voted, used, total: 0 }; }
  const signedBy = (e, keys) => keys.some(k => verifySig(e, k, e.sig));
  if (!signedBy(mint, mint.organiser.keys)) fail(0, 'mint-sig', 'not signed by an organiser key');
  const sum = mint.subjects.reduce((s, x) => s + x.weight, 0);
  if (sum !== mint.total) fail(0, 'total', 'total is ' + mint.total + ' but the weights add up to ' + sum);
  chain.forEach((e, i) => {
    if (i === 0) return;
    if (e.t === 'mint') { fail(i, 'first', 'only the first entry can be a mint'); return; }
    if (closedAt >= 0) fail(i, 'close', 'comes after the poll was closed (entry #' + closedAt + ')');
    if (e.t === 'close') {
      if (!signedBy(e, mint.organiser.keys)) fail(i, 'mint-sig', 'close not signed by an organiser key');
      closedAt = i; return;
    }
    const before = failures.length, s = mint.subjects.find(x => x.id === e.subject);
    if (!s) fail(i, 'subject', '"' + e.subject + '" is not a minted subject');
    else if (!s.keys.includes(e.key) || !verifySig(e, e.key, e.sig)) fail(i, 'vote-sig', 'not signed by one of ' + e.subject + "'s keys");
    if (e.subject in voted) fail(i, 'double', e.subject + ' already voted (entry #' + voted[e.subject] + ')');
    else voted[e.subject] = i;
    const bad = Object.keys(e.alloc).filter(o => !/^(0|[1-9]\d*)$/.test(o) || Number(o) >= mint.options.length);
    if (bad.length) fail(i, 'options', 'no option ' + bad.join(', '));
    const c = cost(e.alloc, mint.quadratic);
    if (s && (c < 1 || c > s.weight)) fail(i, 'cost', 'costs ' + c + ' but ' + e.subject + ' holds ' + s.weight);
    if (failures.length === before && !failures.some(f => f.index === i)) {
      Object.entries(e.alloc).forEach(([o, k]) => { totals[o] += k; }); used += c;
    }
  });
  return { ok: failures.length === 0, failures, status: closedAt >= 0 ? 'closed' : 'live', totals, voted, used, total: mint.total };
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
    return Object.fromEntries(Object.entries(spec).map(([k, check]) => [k, o[k] === undefined && k in defaults ? defaults[k] : check(o[k], path + '.' + k)]));
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
    mint: { v: version, t: str, d: str, title: str, desc: str, options: strs, quadratic: bool,
      organiser: (v, p) => shape(v, p, { id: str, keys: strs }), subjects: subjects(1), total: int(0), dt: str, sig: str },
    vote: { v: version, t: str, d: str, p: str, subject: str, alloc, dt: str, key: str, sig: str },
    close: { v: version, t: str, d: str, p: str, dt: str, sig: str }
  };
  const entry = (e, path) => { obj(e, path); return ENTRY[e.t] ? shape(e, path, ENTRY[e.t]) : fail(path + '.t', 'expected "mint", "vote" or "close"'); };
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
