import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import type { ProviderAccountConfig } from "./model-catalog";

export type AccountFetchResolver = (
  accountId: string,
  account: ProviderAccountConfig,
) => typeof fetch | undefined;

/**
 * Creates opt-in account transports for environments where a TUN route wins
 * over a reachable physical interface. The catalog carries only the name of
 * the environment variable; the address is read at process start and is
 * never included in model audits or persisted state.
 */
export function createModelFetchResolver(
  env: Readonly<Record<string, string | undefined>>,
): AccountFetchResolver {
  const transports = new Map<string, { dispatcher: Agent; fetch: typeof fetch }>();

  return (accountId, account) => {
    const addressEnv = account.network?.local_address_env;
    if (!addressEnv) return undefined;
    const localAddress = env[addressEnv]?.trim();
    if (!localAddress) return undefined;
    if (isIP(localAddress) === 0) {
      throw new Error(
        `model account ${accountId} requires ${addressEnv} to contain a local IP address`,
      );
    }

    const key = `${accountId}:${localAddress}`;
    const existing = transports.get(key);
    if (existing) return existing.fetch;

    // Undici's Agent takes `localAddress` at the top level. Putting it inside
    // `connect` leaves the Client's per-request localAddress null, so macOS
    // still routes the TLS handshake through the VPN TUN interface.
    const dispatcher = new Agent({ localAddress });
    const boundFetch: typeof fetch = async (input, init) => {
      // Node's global Request type and undici's bundled Request type differ
      // slightly across supported Node versions, while the runtime contract
      // is the same fetch(input, init) surface used by the AI SDK.
      const response = await undiciFetch(
        input as unknown as Parameters<typeof undiciFetch>[0],
        { ...init, dispatcher } as Parameters<typeof undiciFetch>[1],
      );
      return response as unknown as Response;
    };
    transports.set(key, { dispatcher, fetch: boundFetch });
    return boundFetch;
  };
}
