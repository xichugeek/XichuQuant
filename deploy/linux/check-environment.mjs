import fs from 'node:fs';
import { isIP } from 'node:net';
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
if (process.argv[3] === '--public-demo' && values.PUBLIC_DEMO_READ_ONLY !== 'true') throw new Error('The public-demo target requires PUBLIC_DEMO_READ_ONLY=true.');
const params=[...(values.DATABASE_URL??'').matchAll(/(?:^|;)database=([^;]*)/gi)];
const pwd=[...(values.DATABASE_URL??'').matchAll(/(?:^|;)password=([^;]*)/gi)];
if (!/^XichuQuantDemo_[A-Za-z0-9_]+$/.test(db??'') || !values.DATABASE_URL.startsWith('sqlserver://sqlserver:1433;') || params.length!==1 || params[0][1]!==db || pwd.length!==1 || decodeURIComponent(pwd[0][1])!==values.MSSQL_SA_PASSWORD) throw new Error('Acceptance requires a dedicated Demo database and matching container SQL credentials/name.');
for (const key of ['MSSQL_SA_PASSWORD','SEED_ADMIN_PASSWORD','JWT_SECRET','BROKER_ACCOUNT_HASH_PEPPER']) {
  if (!values[key] || values[key].includes('INVALID_EXAMPLE') || values[key].length<16) throw new Error(`Configure ${key}; secrets are never printed.`);
}
if (values.SEED_DEMO_CONFIRM!=='CREATE_FICTIONAL_DEMO' || values.BROKER_CONNECTOR_MODE!=='OFFLINE' || values.BROKER_CONNECTOR_ENVIRONMENT!=='DISABLED' || values.IBKR_TWS_API_READ_ONLY!=='true') throw new Error('Acceptance requires explicit Demo Seed and Broker OFFLINE/DISABLED/read-only.');
for (const key of ['IBKR_PAPER_ACCOUNT_ID','BROKER_PAPER_ACCOUNT_HASH_ALLOWLIST','IBKR_PAPER_BASE_URL','IBKR_READONLY_BASE_URL']) { if (values[key]) throw new Error('External broker configuration is prohibited in Demo acceptance.'); }
if (values.PUBLIC_DEMO_READ_ONLY === 'true') {
  if (values.REQUIRE_HTTPS !== 'true' || values.XICHURISK_DATA_MODE !== 'DEMO' || !values.WEB_ORIGIN?.startsWith('https://')) throw new Error('Public Demo requires HTTPS and DEMO mode.');
  for (const key of ['MARKET_DATA_HTTP_BASE_URL','MARKET_DATA_HTTP_API_KEY','FRED_API_KEY']) if (values[key]) throw new Error('External market-data credentials are prohibited in Public Demo.');
  const limit = values.PUBLIC_DEMO_MAX_SESSIONS ?? '100';
  if (!/^\d+$/.test(limit) || Number(limit)<2 || Number(limit)>500) throw new Error('Public Demo session cap must be between 2 and 500.');
  if (!/^\d+$/.test(values.SESSION_TTL_HOURS ?? '1') || Number(values.SESSION_TTL_HOURS ?? '1')<1 || Number(values.SESSION_TTL_HOURS ?? '1')>4) throw new Error('Public Demo session TTL must be between 1 and 4 hours.');
  for (const key of ['PUBLIC_DEMO_PROXY_IP','PUBLIC_DEMO_WEB_IP','CADDY_TRUSTED_PROXY_IP']) {
    if (isIP(values[key] ?? '') !== 4 || values[key] === '0.0.0.0') throw new Error('Configure an exact IPv4 address for ' + key);
  }
  const subnet = (values.PUBLIC_DEMO_FRONTEND_SUBNET ?? '').match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/);
  if (!subnet || isIP(subnet[1]) !== 4 || Number(subnet[2])<24 || Number(subnet[2])>28) throw new Error('Choose a dedicated private IPv4 /24 to /28 subnet.');
  const ipNumber = value => value.split('.').reduce((result, part) => result * 256 + Number(part), 0) >>> 0;
  const network = ipNumber(subnet[1]);
  const mask = (0xffffffff << (32 - Number(subnet[2]))) >>> 0;
  if ((network & mask) >>> 0 !== network || !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(subnet[1])) throw new Error('Use an aligned RFC1918 subnet.');
  const broadcast = (network | ~mask) >>> 0;
  for (const key of ['PUBLIC_DEMO_PROXY_IP','PUBLIC_DEMO_WEB_IP']) {
    const address = ipNumber(values[key]);
    if ((address & mask) >>> 0 !== network || address === network || address === broadcast || address === network + 1) throw new Error('Proxy and Web IPs must be usable non-gateway addresses in the dedicated subnet.');
  }
  if (values.PUBLIC_DEMO_PROXY_IP === values.PUBLIC_DEMO_WEB_IP) throw new Error('Proxy and Web require distinct IPs.');
}
console.log(db);
