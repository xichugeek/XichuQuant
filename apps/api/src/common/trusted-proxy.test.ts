import assert from "node:assert/strict";
import test from "node:test";
import { trustedProxyPolicy } from "./trusted-proxy";

test("Proxy trust defaults to no addresses, including localhost", () => {
  const trust = trustedProxyPolicy();
  for (const address of ["127.0.0.1", "::1", "192.0.2.10"]) assert.equal(trust(address), false);
});
test("Only explicitly configured proxy addresses are trusted", () => {
  const trust = trustedProxyPolicy("192.0.2.10, ::1");
  assert.equal(trust("192.0.2.10"), true);
  assert.equal(trust("::ffff:192.0.2.10"), true);
  assert.equal(trust("::1"), true);
  assert.equal(trust("192.0.2.11"), false);
  assert.equal(trust("198.51.100.20"), false);
});
test("Wildcard, subnet, hop-count, empty-entry and arbitrary proxy settings fail closed", () => {
  for (const value of ["true", "1", "*", "0.0.0.0", "::", "0.0.0.0/0", "192.0.2.0/24", "loopback", "192.0.2.10,", " "]) {
    assert.throws(() => trustedProxyPolicy(value), /explicit proxy IP/);
  }
});
