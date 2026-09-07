# DoraHacks paste

Copy the short blurb first. Use the long form only if the form has a project description field.

## Title

Toxa

## Tagline

Attested Sepolia lock. Creditcoin loan. LTV from score.

## Short (for the one-liner / elevator)

Toxa prices a Sepolia ETH lock on Creditcoin. Attestcoin proves the lock. LTV starts at 60% at score 700 and rises 10 bps per point, cap 80%. Lock +5. Repay +15. Same collateral, better terms, because the score is on-chain.

## What it does

Lock ETH in `CollateralLocker` on Sepolia. Attestcoin Readability (BlockProver `0x0FD2`, Merkle + continuity, `EvmV1Decoder`) proves that lock on Creditcoin. `Toxascore.execute` inherits `ASCBase`, then requires `receipt.status == 1`, emitter == registered locker, and `tx.from == lock.user`. Principal is `amount × LTV` at 1:1 ETH:tCTC. A verified lock adds 5 to score. A repayment adds 15. The next lock borrows more against the same size collateral.

## What it is not

Not a portable credit passport. Not a bridge. Not an oracle. Not a payment that becomes unsecured credit. The ETH is locked. The loan is sized against that lock. The score only moves LTV.

## Attestcoin checks that are load-bearing

1. Merkle inclusion + chain continuity via BlockProver `0x0FD2` (`ASCBase.execute`)
2. Replay protection on `(chainKey, blockHeight, txIndex)`
3. `receipt.status == 1`
4. Log emitter == registered `CollateralLocker`
5. `tx.from == lock.user`

## Live testnet (2026-09-05)

Same CREATE address on both chains: `0x2bF2EC0ebBa8eFc4999460420a86F1F3c1D0b938`

- Locker (Sepolia): https://sepolia.etherscan.io/address/0x2bF2EC0ebBa8eFc4999460420a86F1F3c1D0b938
- ASC (Creditcoin): https://creditcoin-testnet.blockscout.com/address/0x2bF2EC0ebBa8eFc4999460420a86F1F3c1D0b938
- Lock 0.01 ETH: https://sepolia.etherscan.io/tx/0x57d916f64337fd26fa6b867b83414dc86a754b78280c00406c0b34ea789a4724
- Execute / loan #1 0.006 tCTC at 60% LTV, score 700 to 705: https://creditcoin-testnet.blockscout.com/tx/0x1087519dc6ee4ea4003e4950b0a38f9e0be72fa2ab90fb2ff8a7430490517088
- Repay loan #1, score 705 to 720, next LTV 62%: https://creditcoin-testnet.blockscout.com/tx/0x880cc66a02fd3887163b5f8affe111309c05be330047d34103cd444dd7d4c302

- Second lock 0.01 ETH: https://sepolia.etherscan.io/tx/0x787ce03e577622fde1eef1bc060a0e6c0282ba95f5fac803dd1e0d952ba0474a
- Second execute / loan #2 0.0062 tCTC at 62% LTV, score 720 to 725: https://creditcoin-testnet.blockscout.com/tx/0x0d745dc6c8abf8bfba41c04a1aa9731daba731752d042ac6aac81bdef8c4affd

Same 0.01 ETH collateral. Loan #1 was 0.006 tCTC at 60%. Loan #2 is 0.0062 tCTC at 62% because repay moved the score. Full table: `docs/evidence.md`.

## Honest limits

- Sepolia `unlockETH` is not gated by Creditcoin repay. Writability is out of scope.
- No price oracle. 1:1 ETH:tCTC for the hackathon.
- Score is per-address. If you have ETH you can farm it. Toxa prices locked capital. It does not claim a FICO for the world.

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

Demo mode needs no wallet. Live mode uses the addresses in `.env.example`.
