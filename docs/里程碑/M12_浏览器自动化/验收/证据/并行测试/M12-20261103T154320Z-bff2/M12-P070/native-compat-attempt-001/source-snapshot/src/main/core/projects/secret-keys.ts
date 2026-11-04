// app_secrets keys are derived from the owning row's id, so the rows never store a secret reference
// that could drift. M4 maps these to the env var names the Skills expect (passwordEnv).

const serverKeys = (id: string) => ({
  password: `server:${id}:password`,
  passphrase: `server:${id}:passphrase`,
  sudo: `server:${id}:sudo`,
});

export const secretKeys = {
  databasePassword: (id: string) => `db:${id}:password`,
  /** Every key a database row may own. */
  database: (id: string) => [`db:${id}:password`],
  serverKeys,
  server: (id: string) => Object.values(serverKeys(id)),
};
