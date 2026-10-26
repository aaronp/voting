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
