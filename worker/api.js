import { Contract, JsonRpcProvider, Wallet, getAddress } from 'ethers';
import { lockerAbi, toxascoreAbi } from '../src/lib/abi.js';

/**
 * Toxa proof + release API, framework free.
 *
 * The same handler backs the Vite dev middleware (`vite.config.js`) and the
 * standalone server (`worker/server.js`), so a deployed build talks to exactly
 * the endpoints the dev server serves.
 *
 *   POST /api/prove        { txHash }        -> { id }
 *   GET  /api/prove/:id                      -> { status, detail | proof | error }
 *   POST /api/release      { address, amount } -> { amount, deadline, nonce, signature }
 *   GET  /api/health                         -> readiness of both legs
 */

const RELEASE_TTL_SECONDS = 30 * 60;

const env = (name, fallback = '') => process.env[name] || fallback;

function sourceRpcUrl() {
  return env('SEPOLIA_RPC_URL', env('VITE_SEPOLIA_RPC'));
}

function creditcoinRpcUrl() {
  return env('CREDITCOIN_RPC_URL', env('VITE_CREDITCOIN_RPC', 'https://rpc.cc3-testnet.creditcoin.network'));
}

function lockerAddress() {
  return env('LOCKER_ADDRESS', env('VITE_LOCKER_ADDRESS'));
}

function toxascoreAddress() {
  return env('TOXASCORE_ADDRESS', env('VITE_TOXASCORE_ADDRESS'));
}

function releaserWallet() {
  const key = env('RELEASER_PRIVATE_KEY', env('CREDITCOIN_WALLET_PRIVATE_KEY'));
  if (!key) throw new Error('RELEASER_PRIVATE_KEY is not set, the release leg is disabled');
  return new Wallet(key);
}

/**
 * Sign a release voucher for `address`, but only once Creditcoin says the
 * borrower owes nothing. This is the gate that makes the Sepolia collateral a
 * real escrow rather than a parking spot.
 */
export async function signRelease({ address, amount }) {
  const user = getAddress(address);
  const wei = BigInt(amount);
  if (wei <= 0n) throw Object.assign(new Error('amount must be positive'), { status: 400 });

  const locker = lockerAddress();
  const desk = toxascoreAddress();
  if (!locker) throw Object.assign(new Error('LOCKER_ADDRESS is not set'), { status: 503 });
  if (!desk) throw Object.assign(new Error('TOXASCORE_ADDRESS is not set'), { status: 503 });

  const wallet = releaserWallet();
  const source = new JsonRpcProvider(sourceRpcUrl());
  const creditcoin = new JsonRpcProvider(creditcoinRpcUrl());

  const deskContract = new Contract(desk, toxascoreAbi, creditcoin);
  const account = await deskContract.getAccount(user);
  const activeLoan = BigInt(account.activeLoanId ?? account[2]);
  const repaid = Boolean(account.repaid ?? account[5]);
  if (activeLoan !== 0n && !repaid) {
    throw Object.assign(new Error('Repay the open loan on Creditcoin before releasing collateral.'), {
      status: 409,
    });
  }

  const lockerContract = new Contract(locker, lockerAbi, source);
  const locked = BigInt(await lockerContract.getLocked(user));
  if (wei > locked) {
    throw Object.assign(new Error(`Only ${locked} wei is locked for ${user}.`), { status: 400 });
  }

  const onChainReleaser = await lockerContract.releaser();
  if (getAddress(onChainReleaser) !== getAddress(wallet.address)) {
    throw Object.assign(
      new Error(`Locker expects releaser ${onChainReleaser}, this service signs as ${wallet.address}.`),
      { status: 503 },
    );
  }

  const nonce = BigInt(await lockerContract.releaseNonce(user));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + RELEASE_TTL_SECONDS);
  // Let the contract build the digest so the two sides can never drift apart.
  const digest = await lockerContract.releaseDigest(user, wei, nonce, deadline);
  const signature = wallet.signingKey.sign(digest).serialized;

  return {
    address: user,
    amount: wei.toString(),
    nonce: nonce.toString(),
    deadline: deadline.toString(),
    signature,
  };
}

function ensureSepoliaRpc() {
  if (!process.env.SEPOLIA_RPC_URL && sourceRpcUrl()) {
    process.env.SEPOLIA_RPC_URL = sourceRpcUrl();
  }
}

/**
 * Job id is the lock tx hash. Status is computed on every GET so Vercel
 * serverless (no shared memory, no 15-minute lambda) can still prove.
 */
export function startProof(txHash) {
  const hash = String(txHash || '');
  if (!hash.startsWith('0x') || hash.length !== 66) {
    throw Object.assign(new Error('txHash required'), { status: 400 });
  }
  return hash;
}

export async function proofStatus(id) {
  const hash = String(id || '');
  if (!hash.startsWith('0x') || hash.length !== 66) return undefined;
  ensureSepoliaRpc();
  const { proveSnapshot } = await import('./prove.js');
  return proveSnapshot(hash);
}

export function health() {
  let releaser = '';
  try {
    releaser = releaserWallet().address;
  } catch {
    releaser = '';
  }
  return {
    ok: true,
    sepoliaRpc: Boolean(sourceRpcUrl()),
    creditcoinRpc: Boolean(creditcoinRpcUrl()),
    locker: lockerAddress(),
    toxascore: toxascoreAddress(),
    releaser,
    releaseEnabled: Boolean(releaser),
  };
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}'));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
};

/**
 * @returns true when the request was an API call and has been answered.
 */
export async function handleApiRequest(req, res) {
  const url = (req.url || '').split('?')[0];
  if (!url.startsWith('/api/')) return false;

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (url === '/api/health') {
    send(res, 200, health());
    return true;
  }

  if (url === '/api/prove' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      if (!body.txHash || !String(body.txHash).startsWith('0x')) {
        send(res, 400, { error: 'txHash required' });
        return true;
      }
      send(res, 200, { id: startProof(body.txHash) });
    } catch (err) {
      send(res, 400, { error: err.message || 'invalid body' });
    }
    return true;
  }

  if (url.startsWith('/api/prove/') && req.method === 'GET') {
    try {
      const job = await proofStatus(url.slice('/api/prove/'.length));
      if (!job) send(res, 404, { error: 'unknown job' });
      else send(res, 200, job);
    } catch (err) {
      send(res, 500, { error: err.message || 'proof failed' });
    }
    return true;
  }

  if (url === '/api/release' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      send(res, 200, await signRelease(body));
    } catch (err) {
      send(res, err.status || 500, { error: err.message || 'release failed' });
    }
    return true;
  }

  return false;
}
