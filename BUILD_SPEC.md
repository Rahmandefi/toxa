# Toxa build spec

Toxa is a DeFi MVP for BUIDL CTC 2026 Fall: collateral is locked on Sepolia, then proven on Creditcoin with Attestcoin Readability (Merkle + Continuity proofs, BlockProver, and EvmV1Decoder) before a loan is issued.

The Creditcoin contract is an ASC: `execute(action, chainKey, blockHeight, encodedTransaction, merkleRoot, siblings, lowerEndpointDigest, continuityRoots)` inherits `ASCBase` (BlockProver `0x0FD2` + replay protection) and then requires `receipt.status == 1`, a `Locked` event from the registered `CollateralLocker`, and `tx.from == lock.user`. LTV starts at 60% and rises with score (cap 80%).

Scope: Sepolia ETH, portable score, proof-status UX, Foundry tests, live wallet path. Out of scope: mainnet, Writability, advanced liquidation, and multi-chain expansion.

Product differentiator: Toxa is a closed feedback loop. Verified behavior improves the score, and a stronger score unlocks better capital terms on future loans.
