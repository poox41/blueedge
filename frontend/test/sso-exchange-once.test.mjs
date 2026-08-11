import assert from "node:assert/strict";
import test from "node:test";
import { startSsoExchangeOnce } from "../src/auth/sso-exchange-once.ts";

test("one SSO page clears the URL before exactly one Exchange request", () => {
  const guard = { current: false };
  const events = [];

  assert.equal(startSsoExchangeOnce(
    guard,
    () => events.push("clear-url"),
    () => events.push("exchange"),
  ), true);
  assert.equal(startSsoExchangeOnce(
    guard,
    () => events.push("clear-url-again"),
    () => events.push("exchange-again"),
  ), false);

  assert.deepEqual(events, ["clear-url", "exchange"]);
});
