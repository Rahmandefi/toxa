import 'dotenv/config';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import { proveTx } from './prove.js';
import { toxascoreAbi, lockerAbi } from '../src/lib/abi.js';

const POLL_MS = 12_000;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function main() {
  const sourceRpc = required('SEPOLIA_RPC_URL');
  const creditcoinRpc = process.env.CREDITCOIN_RPC_URL || 'https://rpc.cc3-testnet.creditcoin.network';
  const locker = required('LOCKER_ADDRESS');
  const desk = required('TOXASCORE_ADDRESS');
  const key = required('CREDITCOIN_WALLET_PRIVATE_KEY');

  const source = new JsonRpcProvider(sourceRpc);
  const creditcoin = new JsonRpcProvider(creditcoinRpc);
  const wallet = new Wallet(key, creditcoin);
  const lockerContract = new Contract(locker, lockerAbi, source);
  const deskContract = new Contract(desk, toxascoreAbi, wallet);

  const seen = new Set();
  let fromBlock = await source.getBlockNumber();
  console.log(`Toxa worker listening for Locked events from block ${fromBlock}`);
  console.log(`Locker ${locker}`);
  console.log(`Toxa ${desk}`);
  console.log(`Relayer ${wallet.address}`);

  while (true) {
    try {
      const toBlock = await source.getBlockNumber();
      if (toBlock >= fromBlock) {
        const logs = await lockerContract.queryFilter(lockerContract.filters.Locked(), fromBlock, toBlock);
        for (const log of logs) {
          const txHash = log.transactionHash;
          if (seen.has(txHash)) continue;
          seen.add(txHash);
          console.log(`Locked detected ${txHash} user=${log.args?.user} amount=${log.args?.amount}`);
          try {
            const proof = await proveTx(txHash, (status, detail) => {
              console.log(`  [${status}] ${detail || ''}`);
            });
            const tx = await deskContract.execute(
              proof.action,
              proof.chainKey,
              proof.blockHeight,
              proof.encodedTransaction,
              proof.merkleRoot,
              proof.siblings,
              proof.lowerEndpointDigest,
              proof.continuityRoots,
            );
            console.log(`  execute submitted ${tx.hash}`);
            await tx.wait();
            console.log(`  loan issued for ${log.args?.user}`);
          } catch (err) {
            console.error(`  failed to prove/execute ${txHash}:`, err.shortMessage || err.message);
          }
        }
        fromBlock = toBlock + 1;
      }
    } catch (err) {
      console.error('poll error', err.shortMessage || err.message);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
