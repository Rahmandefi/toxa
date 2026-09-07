import 'dotenv/config';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import { proveTx } from './prove.js';
import { toxascoreAbi } from '../src/lib/abi.js';

const txHash = process.argv[2] || process.env.LOCK_TX_HASH;
if (!txHash) {
  console.error('usage: node worker/once.mjs <sepoliaLockTxHash>');
  process.exit(1);
}

const rpc = process.env.CREDITCOIN_RPC_URL || 'https://rpc.cc3-testnet.creditcoin.network';
const desk = process.env.TOXASCORE_ADDRESS;
const key = process.env.CREDITCOIN_WALLET_PRIVATE_KEY || process.env.PRIVATE_KEY;
if (!desk || !key) {
  console.error('TOXASCORE_ADDRESS and CREDITCOIN_WALLET_PRIVATE_KEY (or PRIVATE_KEY) required');
  process.exit(1);
}

const wallet = new Wallet(key, new JsonRpcProvider(rpc));
const contract = new Contract(desk, toxascoreAbi, wallet);

const proof = await proveTx(txHash, (status, detail) => {
  console.log(`[${status}] ${detail || ''}`);
});
console.log('proof ready, executing');
const tx = await contract.execute(
  proof.action,
  proof.chainKey,
  proof.blockHeight,
  proof.encodedTransaction,
  proof.merkleRoot,
  proof.siblings,
  proof.lowerEndpointDigest,
  proof.continuityRoots,
);
console.log('execute', tx.hash);
const receipt = await tx.wait();
console.log('status', receipt.status);
process.exit(receipt.status === 1 ? 0 : 1);
