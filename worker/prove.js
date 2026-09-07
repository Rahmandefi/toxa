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

/**
 * Wait for attestation, then fetch a Merkle + Continuity proof for a Sepolia tx.
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

  const proofBuilder = new proofProvider.service.ProofBuilder(chainKey, proofBuilderUrl);
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
