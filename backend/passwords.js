// Portal passwords. They're stored only as scrypt hashes, in their own "credentials" collection,
// so they never travel with the team list. New people get a temporary password by email and
// choose their own the first time they sign in.
import { scrypt, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
// Each hash records its own cost, so this can be raised later without breaking old passwords.
const COST = { N: 2 ** 15, r: 8, p: 1 };
const MAX_MEMORY = 256 * 1024 * 1024;
export const TEMPORARY_DAYS = 7;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password.normalize('NFKC'), salt, 64, { ...COST, maxmem: MAX_MEMORY });
  return `scrypt$${COST.N}$${COST.r}$${COST.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

// Compares in constant time. With no stored hash it still does the same work, so an unknown
// email takes as long to refuse as a wrong password.
let dummy;
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string') return false;
  const known = typeof stored === 'string' && stored.startsWith('scrypt$');
  const [, N, r, p, salt, hash] = (known ? stored : (dummy ??= await hashPassword(randomBytes(16).toString('hex')))).split('$');
  const expected = Buffer.from(hash, 'base64');
  const actual = await scryptAsync(password.normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: MAX_MEMORY,
  });
  return known && timingSafeEqual(actual, expected);
}

// Like "Kq7m-RtZ3-wP9x": 12 random characters, leaving out ones that are easy to misread (0 O 1 l I).
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
export const temporaryPassword = () =>
  Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => LETTERS[randomInt(LETTERS.length)]).join('')).join('-');

// Why a new password can't be used, or null when it's fine.
export function passwordProblem(password, { email, old } = {}) {
  if (typeof password !== 'string' || password.length < 10) return 'Choose a password of at least 10 characters.';
  if (password.length > 200) return 'That password is too long. Keep it under 200 characters.';
  if (old && password === old) return 'Choose a password that is different from the old one.';
  if (email && password.trim().toLowerCase() === email.toLowerCase()) return "Your password can't be your email address.";
  return null;
}

// Saves a member's password. A temporary one has to be changed at sign-in and expires.
export async function savePassword(store, memberId, password, { temporary = false } = {}) {
  await store.col('credentials').updateOne({ member_id: memberId }, {
    $set: {
      password_hash: await hashPassword(password), temporary,
      expires_at: temporary ? new Date(Date.now() + TEMPORARY_DAYS * 864e5) : null,
      updated_at: new Date().toISOString(),
    },
  }, { upsert: true });
}
