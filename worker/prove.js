import { JsonRpcProvider } from 'ethers';
import { proofProvider, chainInfo } from '@gluwa/usc-sdk';

function env(name, fallback) {
  return process.env[name] || fallback || '';
}

export function proofConfig() {
  return {
    sourceRpc: env('SEPOLIA_RPC_URL', env('SOURCE_CHAIN_RPC_URL')),
    creditcoinRpc: env('CREDITCOIN_RPC_URL', 'https://rpc.cc3-testnet.creditcoin.network'),
    proofBuilderUrl: env('PROOF_BUILDER_URL', 'https://prover.cc3-testnet.creditcoin.network'),
    chainKey: Number(env('SOURCE_CHAIN_KEY', '1')),
  };
}

export function serializeProof(proofData, action = 0) {
  const siblings = (proofData.merkleProof?.siblings || []).map((entry) => ({
    hash: entry.hash ?? entry[0],
    isLeft: Boolean(entry.isLeft ?? entry[1]),
  }));

  return {
    action,
    chainKey: Number(proofData.chainKey),
    blockHeight: Number(proofData.headerNumber),
    encodedTransaction: proofData.txBytes,
    merkleRoot: proofData.merkleProof.root,
    siblings,
    lowerEndpointDigest: proofData.continuityProof.lowerEndpointDigest,
    continuityRoots: proofData.continuityProof.roots || [],
    txHash: proofData.txHash,
  };
}

async function attestedHeight(proofBuilderUrl, chainKey) {
  const url = `${String(proofBuilderUrl).replace(/\/$/, '')}/api/v1/attested-height/${chainKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Proof builder attested-height failed (${res.status})`);
  const body = await res.json();
  const height = Number(body.attestedHeight);
  return Number.isFinite(height) ? height : null;
}

/**
 * One serverless-safe poll. Does not wait 8-15 minutes in-process: the
 * frontend (or a long-lived worker) keeps calling until status is `ready`.
 * Vercel lambdas cannot hold an in-memory job across GET requests.
 */
export async function proveSnapshot(txHash) {
  const { sourceRpc, proofBuilderUrl, chainKey } = proofConfig();
  if (!sourceRpc) throw new Error('SEPOLIA_RPC_URL is not set');
  if (!txHash || !txHash.startsWith('0x') || txHash.length !== 66) {
    throw new Error('txHash required');
  }

  const source = new JsonRpcProvider(sourceRpc);
  const receipt = await source.getTransactionReceipt(txHash);
  if (!receipt?.blockNumber) {
    return { status: 'waiting-receipt', detail: 'Waiting for the Sepolia lock transaction to confirm' };
  }
  if (Number(receipt.status) === 0) {
    throw new Error('Sepolia lock transaction reverted');
  }

  let latest;
  try {
    latest = await attestedHeight(proofBuilderUrl, chainKey);
  } catch (err) {
    return { status: 'waiting-attestation', detail: err.message || 'Proof builder unreachable' };
  }
  if (latest == null) {
    return {
      status: 'waiting-attestation',
      detail: `Waiting for Creditcoin attestors to cover Sepolia block ${receipt.blockNumber}.`,
    };
  }
  if (latest < receipt.blockNumber) {
    return {
      status: 'waiting-attestation',
      detail: `Latest attested Sepolia height: ${latest}. Waiting for ${receipt.blockNumber}.`,
    };
  }

  const proofBuilder = new proofProvider.service.ProofBuilder(chainKey, proofBuilderUrl, 25_000);
  const result = await proofBuilder.getProof(txHash);
  if (!result?.success || !result.data) {
    return {
      status: 'waiting-attestation',
      detail: result?.error || 'Proof builder not ready yet. Retrying.',
    };
  }
  return { status: 'ready', proof: serializeProof(result.data, 0) };
}

/**
 * Wait for attestation, then fetch a Merkle + Continuity proof for a Sepolia tx.
 * For the long-lived worker (`npm run prover` / `npm run worker`) only.
 */
export async function proveTx(txHash, onStatus) {
  const { sourceRpc, creditcoinRpc, proofBuilderUrl, chainKey } = proofConfig();
  if (!sourceRpc) throw new Error('SEPOLIA_RPC_URL is not set');
  if (!txHash || !txHash.startsWith('0x')) throw new Error('txHash required');

  const source = new JsonRpcProvider(sourceRpc);
  const creditcoin = new JsonRpcProvider(creditcoinRpc);

  onStatus?.('waiting-receipt', 'Waiting for the Sepolia lock transaction to confirm');
  const receipt = await source.waitForTransaction(txHash, 1, 120_000);
  if (!receipt?.blockNumber) throw new Error(`Transaction ${txHash} is not mined yet`);

  const proofBuilder = new proofProvider.service.ProofBuilder(chainKey, proofBuilderUrl, 25_000);
  const info = new chainInfo.PrecompileChainInfoProvider(creditcoin);

  onStatus?.('waiting-attestation', `Waiting for block ${receipt.blockNumber} to be attested on Creditcoin`);
  try {
    const latest = await info.getLatestAttestedHeightAndHash(chainKey);
    onStatus?.(
      'waiting-attestation',
      `Latest attested Sepolia height: ${latest.height}. Waiting for ${receipt.blockNumber}.`,
    );
  } catch {
    // Chain-info precompile may be unreachable from some RPCs; proof builder wait is the source of truth.
  }

  await proofBuilder.waitUntilHeightAttested(chainKey, receipt.blockNumber, 15_000, 1_200_000);

  onStatus?.('building', 'Generating Merkle + Continuity proof');
  const result = await proofBuilder.getProof(txHash);
  if (!result?.success || !result.data) {
    throw new Error(result?.error || 'Proof builder returned no data');
  }
  return serializeProof(result.data, 0);
}
