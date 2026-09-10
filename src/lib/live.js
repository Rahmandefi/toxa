import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseEther,
  formatEther,
  decodeEventLog,
} from 'viem';
import { lockerAbi, toxascoreAbi } from './abi.js';
import {
  sepolia,
  creditcoinTestnet,
  lockerAddress,
  toxascoreAddress,
  SEPOLIA_ID,
  CREDITCOIN_TESTNET_ID,
} from './chains.js';

/** Empty means same-origin, which is what `npm run dev` serves. */
const apiBase = () => (import.meta.env.VITE_PROVER_URL || '').replace(/\/$/, '');

const sepoliaPublic = () => createPublicClient({ chain: sepolia, transport: http(sepolia.rpcUrls.default.http[0]) });
const creditcoinPublic = () =>
  createPublicClient({ chain: creditcoinTestnet, transport: http(creditcoinTestnet.rpcUrls.default.http[0]) });

function ethereum() {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('No injected wallet found. Install MetaMask and try again.');
  }
  return window.ethereum;
}

export async function connectWallet() {
  const accounts = await ethereum().request({ method: 'eth_requestAccounts' });
  if (!accounts?.[0]) throw new Error('Wallet connection was rejected.');
  return accounts[0];
}

export async function ensureChain(chain) {
  const hex = `0x${chain.id.toString(16)}`;
  try {
    await ethereum().request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
  } catch (err) {
    if (err?.code === 4902 || err?.message?.includes('Unrecognized chain')) {
      await ethereum().request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: hex,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: chain.rpcUrls.default.http,
          blockExplorerUrls: [chain.blockExplorers.default.url],
        }],
      });
    } else {
      throw err;
    }
  }
}

function walletClient(chain) {
  return createWalletClient({
    chain,
    transport: custom(ethereum()),
  });
}

export async function lockCollateral(account, amountEth) {
  await ensureChain(sepolia);
  const client = walletClient(sepolia);
  const hash = await client.writeContract({
    account,
    address: lockerAddress,
    abi: lockerAbi,
    functionName: 'lockETH',
    value: parseEther(amountEth),
    chain: sepolia,
  });
  const receipt = await sepoliaPublic().waitForTransactionReceipt({ hash });
  let nonce = 0n;
  for (const log of receipt.logs) {
    try {
      const parsed = decodeEventLog({ abi: lockerAbi, data: log.data, topics: log.topics });
      if (parsed.eventName === 'Locked') nonce = parsed.args.nonce;
    } catch {
      // ignore unrelated logs
    }
  }
  return { hash, blockNumber: receipt.blockNumber, nonce: nonce.toString() };
}

export async function startProofJob(txHash) {
  const res = await fetch(`${apiBase()}/api/prove`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ txHash }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Proof API error (${res.status}). Is the Vite dev server running with RPC env set?`);
  }
  return body.id;
}

export async function pollProofJob(id, onStatus) {
  const started = Date.now();
  while (Date.now() - started < 20 * 60 * 1000) {
    const res = await fetch(`${apiBase()}/api/prove/${id}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok && !body.status) {
      throw new Error(body.error || `Proof API error (${res.status}).`);
    }
    if (body.status) onStatus?.(body.status, body.detail);
    if (body.status === 'ready') return body.proof;
    if (body.status === 'error') throw new Error(body.error || 'Proof generation failed');
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error('Timed out waiting for Attestcoin attestation (~15-20 min).');
}

export async function submitProof(account, proof) {
  await ensureChain(creditcoinTestnet);
  const client = walletClient(creditcoinTestnet);
  const hash = await client.writeContract({
    account,
    address: toxascoreAddress,
    abi: toxascoreAbi,
    functionName: 'execute',
    args: [
      0,
      BigInt(proof.chainKey),
      BigInt(proof.blockHeight),
      proof.encodedTransaction,
      proof.merkleRoot,
      proof.siblings,
      proof.lowerEndpointDigest,
      proof.continuityRoots,
    ],
    chain: creditcoinTestnet,
  });
  const receipt = await creditcoinPublic().waitForTransactionReceipt({ hash });
  return { hash, status: receipt.status };
}

export async function fetchAccount(address) {
  if (!toxascoreAddress || !address) return null;
  const account = await creditcoinPublic().readContract({
    address: toxascoreAddress,
    abi: toxascoreAbi,
    functionName: 'getAccount',
    args: [address],
  });
  const score = account.score ?? account[0];
  const ltvBps = account.ltvBps ?? account[1];
  const activeLoanId = account.activeLoanId ?? account[2];
  const principal = account.principal ?? account[3];
  const collateralAmount = account.collateralAmount ?? account[4];
  const repaid = account.repaid ?? account[5];
  return {
    score: Number(score),
    ltvBps: Number(ltvBps),
    activeLoanId: activeLoanId.toString(),
    principal: formatEther(principal),
    collateralAmount: formatEther(collateralAmount),
    repaid: Boolean(repaid),
  };
}

/** What a lock of `amountEth` would draw right now, read before any ETH moves. */
export async function quoteLoan(address, amountEth) {
  if (!toxascoreAddress || !address) return null;
  const [principal, ltvBps, fundable, pool] = await creditcoinPublic().readContract({
    address: toxascoreAddress,
    abi: toxascoreAbi,
    functionName: 'quoteLoan',
    args: [address, parseEther(String(amountEth || '0'))],
  });
  return {
    principal: formatEther(principal),
    ltvBps: Number(ltvBps),
    fundable,
    pool: formatEther(pool),
  };
}

/** Most recent successful lock from this address, so a failed prove can resume without locking again. */
export async function fetchLatestLockTx(address) {
  if (!lockerAddress || !address) return '';
  const client = sepoliaPublic();
  const latest = await client.getBlockNumber();
  const fromBlock = latest > 12_000n ? latest - 12_000n : 0n;
  const logs = await client.getLogs({
    address: lockerAddress,
    event: lockerAbi.find((item) => item.type === 'event' && item.name === 'Locked'),
    args: { user: address },
    fromBlock,
    toBlock: 'latest',
  });
  return logs.at(-1)?.transactionHash || '';
}

/** Sepolia-side collateral: what is escrowed and when the timelock frees it. */
export async function fetchCollateral(address) {
  if (!lockerAddress || !address) return null;
  const client = sepoliaPublic();
  const locked = await client.readContract({
    address: lockerAddress, abi: lockerAbi, functionName: 'getLocked', args: [address],
  });
  let emergencyAt = 0;
  try {
    const at = await client.readContract({
      address: lockerAddress, abi: lockerAbi, functionName: 'emergencyUnlockAt', args: [address],
    });
    emergencyAt = Number(at);
  } catch {
    // locker deployed before the escrow upgrade: no timelock to report
  }
  return { locked: formatEther(locked), emergencyAt };
}

/**
 * Ask the relayer to sign a release voucher. It refuses while a loan is
 * outstanding on Creditcoin, which is what keeps the collateral escrowed.
 */
export async function requestRelease(address, amountEth) {
  const res = await fetch(`${apiBase()}/api/release`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address, amount: parseEther(String(amountEth)).toString() }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Release service error (${res.status}).`);
  return body;
}

export async function unlockCollateral(account, amountEth) {
  const voucher = await requestRelease(account, amountEth);
  await ensureChain(sepolia);
  const client = walletClient(sepolia);
  const hash = await client.writeContract({
    account,
    address: lockerAddress,
    abi: lockerAbi,
    functionName: 'unlockETH',
    args: [BigInt(voucher.amount), BigInt(voucher.deadline), voucher.signature],
    chain: sepolia,
  });
  await sepoliaPublic().waitForTransactionReceipt({ hash });
  return hash;
}

export async function repayLoan(account, loanId, principalEth) {
  await ensureChain(creditcoinTestnet);
  const client = walletClient(creditcoinTestnet);
  const hash = await client.writeContract({
    account,
    address: toxascoreAddress,
    abi: toxascoreAbi,
    functionName: 'repay',
    args: [BigInt(loanId)],
    value: parseEther(principalEth),
    chain: creditcoinTestnet,
  });
  await creditcoinPublic().waitForTransactionReceipt({ hash });
  return hash;
}

export { SEPOLIA_ID, CREDITCOIN_TESTNET_ID, formatEther };
