# Dead-process SQLite lease blocked development restart

Artifact-Version: 1

## Executive summary

Restarting the Next.js development server left an unexpired SQLite ownership row from the terminated server process. `LocalDatabase` rejected the replacement process for up to 15 seconds because lease acquisition considered only owner identity and expiry even though the row already stored the owning PID. World-library requests returned HTTP 500 throughout that interval, and the launcher presented the failure as unreadable local content. Lease acquisition now preserves a live owner's lease but immediately reclaims an unexpired lease whose local PID no longer exists.

## Summary

The local database uses a heartbeat lease to exclude concurrent Living World Engine processes. Next.js restarts its server process after configuration changes and can terminate the previous process without running `LocalDatabase.close()`. The durable lock row therefore outlives its process until the time-based lease expires. A new process starts serving HTTP before that expiry, but every attempt to construct `WorldHost` fails with `LocalDatabaseInUseError`; automatic client retries amplify the same misleading 500 response.

## Timeline

1. The launcher reported that local content could not be read while both world-library endpoints returned HTTP 500.
2. Restarting the development command exposed an older Next.js process, and a clean restart temporarily restored both endpoints.
3. Changing `next.config.ts` during bundled-world work caused Next.js to restart itself and reproduced consecutive 500 responses deterministically.
4. The responses recovered without a source change after the 15-second lease window elapsed.
5. The SQLite row's PID differed from the replacement server PID, while `acquireInstanceLease` selected only `owner_id` and `expires_at`.

## Root cause

The lease schema recorded enough evidence to distinguish a live competing process from a dead predecessor, but acquisition ignored that evidence. Time-based expiry is necessary for a live process that becomes unhealthy, yet it is unnecessarily slow when the operating system can already prove that the local owner process is gone. Existing tests covered orderly `close()` and expired execution recovery; they did not model an unexpired lock whose process had terminated, so development-server restart behavior remained outside the verification boundary.

## Guardrails

- [`local-database.ts`](../../src/server/local-database.ts) checks the recorded PID without sending a signal and reclaims only when the operating system reports that process absent; permission or platform errors conservatively preserve the lease.
- [`execution-ledger.test.ts`](../../src/server/__tests__/execution-ledger.test.ts) proves that an unexpired live lease remains exclusive and an unexpired dead-process lease is reclaimed immediately.
- [Postmortem 0014](0014-world-host-bootstrap-lease-leak.md) remains the guardrail for a different lease failure class: partial `WorldHost` construction must release resources it acquired.
