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
    const bad = Object.keys(e.alloc).filter(o => !(Number(o) < mint.options.length));
    if (bad.length) fail(i, 'options', 'no option ' + bad.join(', '));
    const c = cost(e.alloc, mint.quadratic);
    if (s && (c < 1 || c > s.weight)) fail(i, 'cost', 'costs ' + c + ' but ' + e.subject + ' holds ' + s.weight);
    if (failures.length === before && !failures.some(f => f.index === i)) {
      Object.entries(e.alloc).forEach(([o, k]) => { totals[o] += k; }); used += c;
    }
  });
  return { ok: failures.length === 0, failures, status: closedAt >= 0 ? 'closed' : 'live', totals, voted, used, total: mint.total };
}
