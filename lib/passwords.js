import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 12;
const NON_USER_PASSWORD_HASH = bcrypt.hashSync("timing-normalization-only-42", BCRYPT_ROUNDS);

export function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

export function verifyPasswordForLogin(password, passwordHash) {
  return bcrypt.compare(password, passwordHash || NON_USER_PASSWORD_HASH);
}
