# Toxa

**Credit from proof.**

Cross-chain credit for [BUIDL CTC 2026 Fall](https://buidl.creditcoin.org/). A Sepolia ETH lock is proven on Creditcoin with the Attestcoin Protocol (Merkle + Continuity proofs, BlockProver `0x0FD2`, EvmV1Decoder). The verified lock becomes a loan sized by score.

## What this repo actually does

| Piece | Status |
|---|---|
| Frontend (React + Vite) | Demo mode is fully simulated. Live mode talks to MetaMask, Sepolia, Creditcoin testnet, and a local proof API. |
| `CollateralLocker.sol` (Sepolia) | Locks/unlocks ETH and emits `Locked` for Attestcoin to prove. |
| `Toxascore.sol` (Creditcoin ASC, on-chain name) | ASC inheriting `ASCBase`. Verifies inclusion + continuity, requires `receipt.status == 1`, requires the `Locked` emitter to be the registered locker, then disburses a loan from a self-funded tCTC pool. |
| Proof pipeline (`@gluwa/usc-sdk`) | Implemented in `worker/prove.js`. The Vite dev server exposes `/api/prove`; `npm run worker` can also relayer-submit. |
| Tests | Foundry tests for locker accounting, log binding, LTV, issuance, and repayment. |

Demo mode needs no wallet. Live mode needs deployed addresses in `.env` (see below). Attestation of a Sepolia block on Creditcoin usually takes several minutes.

## Run the demo

```bash
npm install
npm run dev
```

Open the local URL, stay on **Demo**, click **New loan**. No keys, no network.

```bash
npm run test          # forge test
npm run build         # production frontend bundle
```

## Intended live flow

```
User locks ETH on Sepolia via CollateralLocker
  → Locked(user, token, amount, nonce, timestamp)
Proof Builder waits until that block is attested on Creditcoin
  → Merkle inclusion + Continuity proof
Toxa.execute(...) on Creditcoin
  → ASCBase: BlockProver.verifyAndEmit + replay protection
  → decode Locked, require emitter == sourceLocker, receipt.status == 1
  → disburse principal = amount * LTV (1:1 ETH:tCTC mock FX)
  → score += 5
Repay on Creditcoin
  → score += 15, next loan gets a higher LTV (cap 80%)
```

## Deploy (Creditcoin testnet + Sepolia)

1. Copy `.env.example` → `.env` and set RPCs plus `PRIVATE_KEY`.
2. Sepolia locker:

```bash
forge script script/DeployLocker.s.sol:DeployLocker \
  --rpc-url $SEPOLIA_RPC_URL --broadcast --private-key $PRIVATE_KEY
```

3. Put the locker address in `.env` as `LOCKER_ADDRESS` / `VITE_LOCKER_ADDRESS`.
4. Creditcoin ASC (EvmV1Decoder is inlined; no library link required):

```bash
forge script script/DeployToxascore.s.sol:DeployToxascore \
  --rpc-url $CREDITCOIN_RPC_URL --broadcast --private-key $PRIVATE_KEY
```

5. Fund the loan pool with tCTC:

```bash
cast send $TOXASCORE_ADDRESS "fundPool()" --value 1ether \
  --rpc-url $CREDITCOIN_RPC_URL --private-key $PRIVATE_KEY
```

6. Restart `npm run dev`, switch the UI to **Live**, connect a wallet.

Optional relayer (so the user only signs the Sepolia lock):

```bash
npm run worker
```

Faucets: Sepolia ETH from a public faucet; tCTC from the [Creditcoin Discord `#token-faucet`](https://docs.creditcoin.org/wallets/using-testnet-faucet.md).

## Live testnet (2026-09-05)

Same CREATE address on both chains (first nonce from the deployer). Clickable table: [`docs/evidence.md`](docs/evidence.md). DoraHacks paste: [`DORA.md`](DORA.md).

| Piece | Chain | Address / tx |
|---|---|---|
| CollateralLocker | Sepolia | [`0x2bF2EC0ebBa8eFc4999460420a86F1F3c1D0b938`](https://sepolia.etherscan.io/address/0x2bF2EC0ebBa8eFc4999460420a86F1F3c1D0b938) |
| Toxa ASC | Creditcoin testnet | [`0x2bF2EC0ebBa8eFc4999460420a86F1F3c1D0b938`](https://creditcoin-testnet.blockscout.com/address/0x2bF2EC0ebBa8eFc4999460420a86F1F3c1D0b938) |
| Lock 0.01 ETH | Sepolia | [`0x57d916f6…4724`](https://sepolia.etherscan.io/tx/0x57d916f64337fd26fa6b867b83414dc86a754b78280c00406c0b34ea789a4724) |
| Attestcoin execute / loan | Creditcoin | [`0x1087519d…7088`](https://creditcoin-testnet.blockscout.com/tx/0x1087519dc6ee4ea4003e4950b0a38f9e0be72fa2ab90fb2ff8a7430490517088) |
| Repay loan #1 | Creditcoin | [`0x880cc66a…c302`](https://creditcoin-testnet.blockscout.com/tx/0x880cc66a02fd3887163b5f8affe111309c05be330047d34103cd444dd7d4c302) |
| Second lock 0.01 ETH | Sepolia | [`0x787ce03e…474a`](https://sepolia.etherscan.io/tx/0x787ce03e577622fde1eef1bc060a0e6c0282ba95f5fac803dd1e0d952ba0474a) |
| Second execute / loan #2 | Creditcoin | [`0x0d745dc6…affd`](https://creditcoin-testnet.blockscout.com/tx/0x0d745dc6c8abf8bfba41c04a1aa9731daba731752d042ac6aac81bdef8c4affd) |

Loan #1: 0.006 tCTC at 60% LTV, score 700 → 705. Repay: score 705 → 720, next LTV 62%. Loan #2, same 0.01 ETH collateral: **0.0062 tCTC at 62% LTV**, score 720 → 725. That is the loop.

### What `execute` requires

Inherited from `ASCBase`, then Toxa:

1. Merkle inclusion + continuity at BlockProver `0x0FD2`
2. Replay protection on `(chainKey, blockHeight, txIndex)`
3. `receipt.status == 1`
4. `Locked` emitter == registered locker
5. `tx.from == lock.user`

### Honest limits

- Sepolia `unlockETH` is not gated by Creditcoin repay. Writability is out of scope.
- No price oracle. 1:1 ETH:tCTC.
- Score is per-address. If you have ETH you can farm it. Toxa prices locked capital. It does not claim a FICO for the world.

## Score loop

- Starting score **700**, base LTV **60%**
- Verified lock **+5**, repayment **+15**
- LTV **+10 bps per score point** above 700, **capped at 80%**

## Scope

- **In:** Sepolia ETH collateral, Attestcoin Readability, portable score, proof-status UX, Foundry tests.
- **Out:** mainnet, Writability (so Sepolia `unlockETH` is still a demo escape hatch), price oracles, liquidations, ERC-20/RWA collateral.

## Layout

- `src/` - dashboard (demo + live)
- `src/lib/` - chain config, ABIs, wallet/proof helpers
- `contracts/sepolia/CollateralLocker.sol`
- `contracts/creditcoin/Toxascore.sol`
- `worker/` - proof generation + optional relayer
- `test/` - Foundry tests
- `script/` - deploy scripts
- `BUILD_SPEC.md` - original product spec
- `AUDIT.md` - earlier self-audit; contracts now implement punch-list items 8-11

Built for the Attestcoin Protocol on Creditcoin.
