import { hashPassword, verifyPassword } from "./passwords.js";

export class ProfileAccountError extends Error {
  constructor(message, { code, status }) {
    super(message);
    this.name = "ProfileAccountError";
    this.code = code;
    this.status = status;
  }
}

export async function findOwnProfile(database, userId) {
  const { rows } = await database.query(
    `SELECT users.id, users.name, users.email, users.created_at, users.updated_at,
            COUNT(products.id)::integer AS saved_products_count
       FROM users
       LEFT JOIN products ON products.user_id = users.id
      WHERE users.id = $1
      GROUP BY users.id`,
    [userId],
  );
  return rows[0] || null;
}

export async function updateOwnProfile(database, userId, input) {
  // Explicit allowlist: account email is never written by profile updates.
  const { rows } = await database.query(
    `WITH updated_user AS (
       UPDATE users
          SET name = $2
        WHERE id = $1
        RETURNING id, name, email, created_at, updated_at
     )
     SELECT updated_user.*,
            (SELECT COUNT(*)::integer FROM products WHERE user_id = updated_user.id) AS saved_products_count
       FROM updated_user`,
    [userId, input.name],
  );
  return rows[0] || null;
}

export async function changeOwnPassword(
  database,
  userId,
  input,
  { verify = verifyPassword, hash = hashPassword } = {},
) {
  const { rows } = await database.query("SELECT password_hash FROM users WHERE id = $1", [userId]);
  const passwordHash = rows[0]?.password_hash;
  if (!passwordHash) {
    throw new ProfileAccountError("Sua sessão expirou. Entre novamente.", {
      code: "SESSION_REQUIRED",
      status: 401,
    });
  }

  if (!(await verify(input.currentPassword, passwordHash))) {
    throw new ProfileAccountError("A senha atual está incorreta.", {
      code: "CURRENT_PASSWORD_INCORRECT",
      status: 400,
    });
  }

  const newPasswordHash = await hash(input.newPassword);
  const result = await database.query(
    "UPDATE users SET password_hash = $2 WHERE id = $1 AND password_hash = $3",
    [userId, newPasswordHash, passwordHash],
  );
  if (result.rowCount !== 1) {
    throw new ProfileAccountError("A senha foi alterada em outra sessão. Atualize a página e tente novamente.", {
      code: "PASSWORD_CHANGED_RETRY",
      status: 409,
    });
  }
}

export async function revokeUserSessions(database, userId) {
  await database.query("DELETE FROM user_sessions WHERE sess->>'userId' = $1", [userId]);
}

export async function changeOwnPasswordAndRevokeSessions(
  database,
  userId,
  input,
  dependencies,
) {
  const client = await database.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await changeOwnPassword(client, userId, input, dependencies);
    await revokeUserSessions(client, userId);
    await client.query("COMMIT");
  } catch (error) {
    if (transactionStarted) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export function profileAccountErrorForClient(error) {
  return { error: error.message, code: error.code };
}
