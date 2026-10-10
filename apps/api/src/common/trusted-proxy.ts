import { isIP } from "node:net";

function normalize(address: string) {
  return address.startsWith("::ffff:") && isIP(address.slice(7)) === 4 ? address.slice(7) : address;
}

// Exact addresses only: no booleans, hop counts, wildcard ranges or all-network CIDRs.
export function trustedProxyPolicy(value = "") {
  const addresses = value ? value.split(",").map((item) => item.trim()) : [];
  if (addresses.some((address) => !isIP(address) || ["0.0.0.0", "::"].includes(address))) {
    throw new Error("TRUSTED_PROXY_IPS must contain explicit proxy IP addresses only.");
  }
  const trusted = new Set(addresses.map(normalize));
  return (address: string) => trusted.has(normalize(address));
}
