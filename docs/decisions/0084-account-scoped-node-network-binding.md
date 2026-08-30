# Account-scoped Node Network Binding

## Status

Accepted
Class: architecture

## Context and Problem Statement

The local Qwen gateway is reachable through the physical network interface but
the default Node route is captured by a TUN client. A process-wide route change
would either require changing the user's VPN policy or accidentally send other
model providers through the same interface. The engine already creates one
transport per model account, so network selection can remain an account-owned
transport concern.

## Decision Drivers

- Allow the local Qwen account to bypass a broken TUN route.
- Keep other provider accounts on their existing network path.
- Avoid persisting local interface addresses, VPN settings, or credentials.
- Preserve the AI SDK fetch contract, retries, scheduling, and audit behavior.
- Make the option explicit and reusable for future private model accounts.

## Considered Options

1. Require a VPN `DIRECT` rule and keep Node on the default route.
2. Replace the process-wide global `fetch` with a physical-interface transport.
3. Add an account-scoped `undici.Agent` transport selected by an environment variable.
4. Add OS routes or a local reverse proxy outside the engine.

## Decision Outcome

Add an optional `network.local_address_env` field to provider accounts. The
model gateway resolves an account-specific `fetch` only when that environment
variable contains an IP literal. The Qwen account opts in with
`QWEN_LOCAL_ADDRESS`; the value is supplied at process start and is not part of
the catalog, model audit, execution ledger, or repository. The transport uses
an `undici.Agent` with `connect.localAddress` and is injected only for that
account. Missing configuration preserves the default fetch path.

## Pros and Cons of the Options

### VPN `DIRECT` rule

- Pros: no application code and applies to all clients consistently.
- Cons: depends on the user's TUN rule ordering and was observed to be
  unreliable in the local environment.

### Process-wide fetch replacement

- Pros: small integration surface.
- Cons: silently changes routing for unrelated providers and makes a local
  network assumption global to the server.

### Account-scoped `undici.Agent` (selected)

- Pros: isolates the workaround to the affected account, keeps provider
  selection explicit, and works with the existing per-account adapter fetch
  injection point.
- Cons: the physical-interface address can change, so the process must be
  restarted with a fresh environment value; the direct dependency adds a
  small transport surface.

### OS route or reverse proxy

- Pros: can cover clients that do not expose a custom fetch.
- Cons: requires privileged or separately managed system state and is outside
  the engine's ownership boundary.

## Links

- [Model catalog and Gateway](../game-design/model-gateway.md)
- [Qwen Campus Model Profile](0083-qwen-campus-model-profile.md)
- [Node `undici` Agent documentation](https://undici.nodejs.org/#/docs/api/Agent)
