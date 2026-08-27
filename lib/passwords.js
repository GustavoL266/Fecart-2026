import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 12;

export function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}
