// Must run before importing Prisma. Windows launchers cannot export empty values.
if (process.env.XICHURISK_ENV_ISOLATED === "true" && process.env.XICHURISK_EMPTY_ENV_KEYS) {
  const keys: unknown = JSON.parse(process.env.XICHURISK_EMPTY_ENV_KEYS);
  if (!Array.isArray(keys) || keys.some(key => typeof key !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))) {
    throw new Error("Invalid isolated environment empty-key manifest.");
  }
  for (const key of keys) process.env[key] = "";
}
