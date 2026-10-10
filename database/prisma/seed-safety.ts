export function assertDemoSeedTarget(databaseUrl: string | undefined, confirmation: string | undefined) {
  const databases = [...(databaseUrl ?? "").matchAll(/(?:^|;)database=([^;]*)/gi)];
  const database = databases.length === 1 ? databases[0]?.[1] : undefined;
  if (confirmation !== "CREATE_FICTIONAL_DEMO" || !database ||
      !/^(XichuQuantDemo|XichuQuantPhaseBTest)_[A-Za-z0-9_]+$/.test(database)) {
    throw new Error("Demo Seed requires explicit CREATE_FICTIONAL_DEMO confirmation and a dedicated XichuQuantDemo_* or XichuQuantPhaseBTest_* database. User databases are never seeded.");
  }
  return database;
}
