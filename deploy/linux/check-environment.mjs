import fs from 'node:fs';
const file = process.argv[2];
if (!file) throw new Error('Pass a protected environment file.');
if (process.platform === 'linux' && (fs.statSync(file).mode & 0o077)) throw new Error('Environment file must have mode 600 or stricter.');
const values = {};
for (const raw of fs.readFileSync(file,'utf8').split(/\r?\n/)) {
  const line=raw.trim(); if (!line || line.startsWith('#')) continue;
  const match=line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/); if (!match || Object.hasOwn(values,match[1])) throw new Error('Malformed or duplicate environment key.');
  let value=match[2].trim();
  if (value.startsWith('"') || value.startsWith("'")) { if (value.at(-1)!==value[0]) throw new Error('Unclosed environment quote.'); value=value.slice(1,-1); }
  values[match[1]]=value;
}
const db=values.XICHURISK_DATABASE_NAME;
const params=[...(values.DATABASE_URL??'').matchAll(/(?:^|;)database=([^;]*)/gi)];
const pwd=[...(values.DATABASE_URL??'').matchAll(/(?:^|;)password=([^;]*)/gi)];
if (!/^XichuQuantDemo_[A-Za-z0-9_]+$/.test(db??'') || !values.DATABASE_URL.startsWith('sqlserver://sqlserver:1433;') || params.length!==1 || params[0][1]!==db || pwd.length!==1 || decodeURIComponent(pwd[0][1])!==values.MSSQL_SA_PASSWORD) throw new Error('Acceptance requires a dedicated Demo database and matching container SQL credentials/name.');
for (const key of ['MSSQL_SA_PASSWORD','SEED_ADMIN_PASSWORD','JWT_SECRET','BROKER_ACCOUNT_HASH_PEPPER']) {
  if (!values[key] || values[key].includes('INVALID_EXAMPLE') || values[key].length<16) throw new Error(`Configure ${key}; secrets are never printed.`);
}
if (values.SEED_DEMO_CONFIRM!=='CREATE_FICTIONAL_DEMO' || values.BROKER_CONNECTOR_MODE!=='OFFLINE' || values.BROKER_CONNECTOR_ENVIRONMENT!=='DISABLED' || values.IBKR_TWS_API_READ_ONLY!=='true') throw new Error('Acceptance requires explicit Demo Seed and Broker OFFLINE/DISABLED/read-only.');
for (const key of ['IBKR_PAPER_ACCOUNT_ID','BROKER_PAPER_ACCOUNT_HASH_ALLOWLIST','IBKR_PAPER_BASE_URL','IBKR_READONLY_BASE_URL']) { if (values[key]) throw new Error('External broker configuration is prohibited in Demo acceptance.'); }
console.log(db);
