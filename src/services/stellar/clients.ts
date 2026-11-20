import { Keypair, rpc } from '@stellar/stellar-sdk';
import { basicNodeSigner } from '@stellar/stellar-sdk/contract';
import type { ClientOptions } from '@stellar/stellar-sdk/contract';
import { Client as MarketCoreClient } from '../../generated/market-core';
import { Client as TreasuryClient } from '../../generated/treasury';
import { Client as ResolverClient } from '../../generated/resolver';
import { Client as ReasoningRegistryClient } from '../../generated/reasoning-registry';
import { config } from '../../config';
import { CONTRACTS, DEPLOYED_AGENT } from '../../config/contracts';

export { MarketCoreClient, TreasuryClient, ResolverClient, ReasoningRegistryClient };

export const rpcServer = new rpc.Server(config.STELLAR_RPC_URL, {
  allowHttp: config.STELLAR_RPC_URL.startsWith('http://'),
});

export type Signer = Pick<ClientOptions, 'publicKey' | 'signTransaction' | 'signAuthEntry'>;
export type SignerRole = 'MARKET_MAKER' | 'TRADER' | 'OPS';

function secretFor(role: SignerRole): string | undefined {
  return role === 'MARKET_MAKER'
    ? (config.AGENT_MAKER_SECRET_KEY || config.AGENT_SECRET_KEY)
    : role === 'TRADER'
      ? (config.AGENT_TRADER_SECRET_KEY || config.AGENT_SECRET_KEY)
      : config.AGENT_SECRET_KEY;
}

export function agentKeypair(role: SignerRole): Keypair {
  const secret = secretFor(role);
  if (!secret) throw new Error(`${role} signer is not configured`);
  return Keypair.fromSecret(secret);
}

export function baseOptions(contractId: string, signer: Signer = {}): ClientOptions {
  return {
    contractId,
    rpcUrl: config.STELLAR_RPC_URL,
    networkPassphrase: config.STELLAR_NETWORK_PASSPHRASE,
    allowHttp: config.STELLAR_RPC_URL.startsWith('http://'),
    ...({ timeoutInSeconds: Math.ceil(config.TIMEOUT_RPC_WRITE_MS / 1000) } as object),
    ...signer,
  };
}

/** Read-only clients: simulation only, no source account needed. */
export const readClients = {
  marketCore: () => new MarketCoreClient(baseOptions(CONTRACTS.marketCore)),
  treasury: () => new TreasuryClient(baseOptions(CONTRACTS.treasury)),
  resolver: () => new ResolverClient(baseOptions(CONTRACTS.resolver)),
  reasoningRegistry: () => new ReasoningRegistryClient(baseOptions(CONTRACTS.reasoningRegistry)),
};

/**
 * The agent identity used for writes.
 *
 * live: the ops key signs. Scoped writes use signerFor(role).
 * dry-run: transactions are simulated with the agent's public key as the
 * source (from AGENT_SECRET_KEY if set, otherwise the agent recorded in the
 * deployments file) and no signer is attached, so nothing can be signed.
 */
export function agentSigner(): Signer {
  return signerFor('OPS');
}

/** Resolve the identity for a write scope without breaking single-key installs. */
export function signerFor(role: SignerRole): Signer {
  const secret = secretFor(role);
  if (config.CHAIN_EXECUTION_MODE === 'live') {
    if (!secret) throw new Error(`${role} signer is not configured`);
    const keypair = agentKeypair(role);
    const { signTransaction, signAuthEntry } = basicNodeSigner(keypair, config.STELLAR_NETWORK_PASSPHRASE);
    return { publicKey: keypair.publicKey(), signTransaction, signAuthEntry };
  }
  const publicKey = secret
    ? agentKeypair(role).publicKey()
    : DEPLOYED_AGENT;
  return { publicKey };
}

export function agentAddresses(): Record<SignerRole, string> {
  return {
    MARKET_MAKER: signerFor('MARKET_MAKER').publicKey as string,
    TRADER: signerFor('TRADER').publicKey as string,
    OPS: signerFor('OPS').publicKey as string,
  };
}

export const agentClients = {
  // The agent is only the fee source for the resolver: both calls are
  // permissionless (#90).
  resolver: (signer: Signer = agentSigner()) => new ResolverClient(baseOptions(CONTRACTS.resolver, signer)),
  treasury: (signer: Signer = agentSigner()) => new TreasuryClient(baseOptions(CONTRACTS.treasury, signer)),
  reasoningRegistry: (signer: Signer = agentSigner()) =>
    new ReasoningRegistryClient(baseOptions(CONTRACTS.reasoningRegistry, signer)),
};
