# Live evidence

Clickable hashes for judges. All values below were read from chain, not from the UI.

Contracts share one CREATE address (deployer nonce 0 on both chains):

`0x2bF2EC0ebBa8eFc4999460420a86F1F3c1D0b938`

| What | Chain | Link |
|---|---|---|
| CollateralLocker | Sepolia | [address](https://sepolia.etherscan.io/address/0x2bF2EC0ebBa8eFc4999460420a86F1F3c1D0b938) |
| Toxa ASC (`Toxascore.sol`) | Creditcoin testnet | [address](https://creditcoin-testnet.blockscout.com/address/0x2bF2EC0ebBa8eFc4999460420a86F1F3c1D0b938) |
| Lock 0.01 ETH | Sepolia | [0x57d916f6…4724](https://sepolia.etherscan.io/tx/0x57d916f64337fd26fa6b867b83414dc86a754b78280c00406c0b34ea789a4724) |
| Attestcoin execute, loan #1 | Creditcoin | [0x1087519d…7088](https://creditcoin-testnet.blockscout.com/tx/0x1087519dc6ee4ea4003e4950b0a38f9e0be72fa2ab90fb2ff8a7430490517088) |
| Repay loan #1 | Creditcoin | [0x880cc66a…c302](https://creditcoin-testnet.blockscout.com/tx/0x880cc66a02fd3887163b5f8affe111309c05be330047d34103cd444dd7d4c302) |
| Second lock | Sepolia | [0x787ce03e…474a](https://sepolia.etherscan.io/tx/0x787ce03e577622fde1eef1bc060a0e6c0282ba95f5fac803dd1e0d952ba0474a) |
| Second execute, loan #2 | Creditcoin | [0x0d745dc6…affd](https://creditcoin-testnet.blockscout.com/tx/0x0d745dc6c8abf8bfba41c04a1aa9731daba731752d042ac6aac81bdef8c4affd) |

## Loan #1 (as of execute)

- Borrower: `0xA60f09cCDbb3e0F840496BB036856e151aD78e3d`
- Collateral: 0.01 ETH
- Principal: 0.006 tCTC (60.0% LTV)
- Score: 700 → 705
- Next LTV: 60.5% (6050 bps)

## Repay loan #1

- Tx: [0x880cc66a…c302](https://creditcoin-testnet.blockscout.com/tx/0x880cc66a02fd3887163b5f8affe111309c05be330047d34103cd444dd7d4c302)
- Score: 705 → 720
- Next LTV: 62.0% (6200 bps)
- Pool returned to 10 tCTC

## Loan #2 (after repay)

- Lock: [0x787ce03e…474a](https://sepolia.etherscan.io/tx/0x787ce03e577622fde1eef1bc060a0e6c0282ba95f5fac803dd1e0d952ba0474a)
- Execute: [0x0d745dc6…affd](https://creditcoin-testnet.blockscout.com/tx/0x0d745dc6c8abf8bfba41c04a1aa9731daba731752d042ac6aac81bdef8c4affd)
- Sepolia block proven: 11648508
- Collateral: 0.01 ETH
- Principal: 0.0062 tCTC (62.0% LTV, not 60%)
- Score: 720 → 725
- Next LTV: 62.5% (6250 bps)

Same collateral size as loan #1. Higher LTV because repay moved the score. That is the product.
- Sepolia block proven: 11640288
- BlockProver: `0x0FD2`
- Source chain key: 1

## What `execute` required

Inherited from `ASCBase`, then Toxa:

1. Merkle inclusion + continuity at BlockProver `0x0FD2`
2. Replay protection on `(chainKey, blockHeight, txIndex)`
3. `receipt.status == 1`
4. `Locked` emitter == registered locker
5. `tx.from == lock.user`

Amount is taken from the proven `Locked` log, not from `msg.sender`. Principal is `collateral × ltvFor(score)`.

## Honest limits

- `CollateralLocker.unlockETH` is a testnet escape hatch. It is not gated by Creditcoin repay.
- FX is 1:1 ETH:tCTC. No oracle.
- Score is per-address and costs ETH to move. That is not a bureau identity system.
