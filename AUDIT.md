# Toxascore - Empirical Audit & Readiness Evaluation

_Date: 2026-09-03_
_Scope reviewed: `README.md`, `BUILD_SPEC.md`, `index.html`, `package.json`, `package-lock.json`, `src/main.jsx`, `src/styles.css`, `contracts/creditcoin/Toxascore.sol`, `contracts/sepolia/CollateralLocker.sol`_
_Target: BUIDL CTC 2026 Fall hackathon (https://buidl.creditcoin.org/)_

> **Note:** this audit describes the repo as it stood on 2026-09-03, before the punch-list fixes below were applied. Kept here as a record of what changed and why - see README.md for current status.

---

## Bottom line

**Readiness: ~25% of a working hackathon submission.** What exists is a polished, offline **UI mockup** plus two **stub contracts that explicitly do not implement the core mechanism**. Every claim in the README about cross-chain proof verification (`@gluwa/usc-sdk`, BlockProver, EvmV1Decoder, Merkle + Continuity proofs) is currently unimplemented - no code performs it, and the SDK is not a dependency.

- If judging rewards a working on-chain integration → this does not clear the bar.
- If judging rewards concept + design + a demo video → the front end carries it.

The hackathon site (`buidl.creditcoin.org`) is a JS-only SPA and returned no readable content, so this audit is **not** scored against the actual rubric. Paste the rules for a rubric-specific re-score.

---

## What was verified empirically

| Step | Result |
|---|---|
| `npm install` | PASS - 22 packages, 0 vulnerabilities, ~1 min |
| `npm run build` | PASS - 520 ms → `dist/` (index 1.2 kB, CSS 8.7 kB, JS 201 kB / 63 kB gzip) |
| `npm run dev` | PASS - Vite 8.2.2, serves HTTP 200 on `:5173`, `main.jsx` transforms cleanly |
| Resolved versions | React 19.2.8, Vite 8.2.2, `@vitejs/plugin-react` 6.1.1, `lucide-react` 1.39.0 |
| Contracts compile | NOT POSSIBLE IN-REPO - no Hardhat/Foundry config, no scripts, no artifacts |
| Tests | NONE EXIST |

The demo runs with no keys, no wallet, and no network - which is judge-friendly.

---

## Front end (`src/main.jsx`, ~30 dense lines)

It is a state machine with 3 variables, not an app. `advance()` increments a `stage` counter; at stage 3 it flips `loan=true` and hard-sets `score` 742 → 748. There is zero web3: no ethers/viem/wagmi, no wallet connector, no contract ABI, no RPC.

### Defects

- **3 of 5 nav items are dead.** Render logic is `view==='borrow' ? <Borrow/> : <Overview/>`. Clicking **Credit Score**, **Activity**, or **Docs** re-renders Overview. Judges will click these.
- **"Connect wallet"** toggles a hardcoded string `0x71…4C2A`. No connection.
- **No-op buttons:** "View live proofs", "View proof", "Improve score", "View all activity", header help button - all inert.
- **Dead code branch:** `Borrow` has a `stage===0` "Lock collateral" button, but `begin()` sets `stage=1` before `Borrow` mounts, so that label never renders.
- **Unused imports:** `Copy`, `Zap`.
- **`@vitejs/plugin-react` installed but unused** - no `vite.config.js`. JSX transpiles via esbuild, so Fast Refresh is off; the dependency signals an unfinished config.
- **Incoherent branding.** Docs say "Toxascore"; the UI brand mark renders **"AttestCredit"**, the sidebar says **"POWERED BY Creditcoin"**, the disclaimer says **"Secured by the Attestcoin Protocol"**. "Attestcoin" / "Creditcoin" / "Toxascore" / "AttestCredit" are used interchangeably across README, spec, and UI. Pick one name for the entity and one for the protocol.
- **Minor:** score ring is a hardcoded `conic-gradient(... 87% ...)` regardless of score; accessibility is thin (non-semantic `nav`, no aria labels).

### Strengths

The CSS is genuinely good - coherent dark theme, real type scale, two working responsive breakpoints, tasteful proof-status states. Visually it reads as a real product.

---

## Smart contracts

### `contracts/sepolia/CollateralLocker.sol` (7 lines)

```solidity
function lockETH() external payable { require(msg.value > 0,"amount=0"); emit Locked(...); }
```

- **CRITICAL - funds permanently unrecoverable.** No `withdraw`, no owner, no `unlock`, no `selfdestruct`. Any ETH sent here (testnet or not) is bricked. A judge who locks collateral to test the flow cannot get it back, and there is no path for the loan system to release it.
- **HIGH** - the `token` field in the event is always `address(0)`; despite README "ERC-20/RWA" language there is no ERC-20 path.
- **HIGH** - no linkage to `Toxascore`; nothing records which lock backs which loan.

### `contracts/creditcoin/Toxascore.sol` (22 lines)

- **CRITICAL - `processCollateralLock` verifies nothing.** Its first three params (`uint64, uint64, bytes calldata`) are unnamed and unused. No BlockProver, no EvmV1Decoder, no Merkle root check, no continuity check, no receipt-status check, no `Locked`-event decode. It is permissionless: anyone passes any random `queryId` and unconditionally receives a loan + `creditScore += 1`.
- **CRITICAL - the credit score is Sybil-trivial and meaningless.** Loop `processCollateralLock` with fresh queryIds for +1 each; call `repay` (which transfers no funds, just flips a bool) for +10 each. No cost, no collateral checked, no identity.
- **CRITICAL - there is no lending asset.** `repay` moves no funds; `processCollateralLock` issues a "principal" that is never disbursed. `principal = 1 ether * ltvFor / 1000` hardcodes a 1 ETH collateral assumption independent of the real lock amount.
- **MEDIUM** - `nextLoanId` unbounded; no access control anywhere.

The inline comments are honest ("Wire the official BlockProver…", "Production wiring verifies…"), so the code itself is not deceptive - but the README describes this wiring in the present tense as though it exists.

---

## Docs vs. reality gap

README states:

> "The production integration passes the official SDK Merkle + Continuity proof payload to `processCollateralLock` and validates receipt status plus the `Locked` event via BlockProver/EvmV1Decoder."

Reality: `@gluwa/usc-sdk` is not in `package.json`; `processCollateralLock` discards its proof arguments; nothing validates a receipt or an event. `BUILD_SPEC.md` hedges better ("Production wiring **should** implement…"), but the README over-claims. A judge who reads the contract after the README will feel misled.

---

## Packaging / reproducibility

- **Every dependency pinned to `"latest"`** in `package.json`. The build works today because the lockfile pins real versions, but `package.json` is non-reproducible and a fresh install that ignores the lock could pull breaking majors. Pin real semver ranges.
- Not a git repository. Contracts declare `SPDX MIT` but there is no `LICENSE` file.
- No `.gitignore`, no CI, no deploy scripts, no `.env.example`, no testnet contract addresses, no block-explorer verification links.
- `:Zone.Identifier` files present - Windows mark-of-the-web cruft from `Toxascore.zip` (Telegram download). Harmless but delete before submitting; they leak provenance.

---

## Readiness matrix

| Dimension | State |
|---|---|
| Concept / narrative | STRONG - clear, compelling ("lock once, borrow better, score everywhere"; closed feedback loop) |
| Demo that runs | YES - offline, no setup friction |
| UI/UX quality | STRONG for a hackathon |
| Working smart contracts | NO - stubs only, not deployed, not compiled in-repo |
| Creditcoin USC / Attestcoin integration (the point) | NOT STARTED |
| Tests | NONE |
| On-chain proof / deployment evidence | NONE |
| Honesty of submission materials | AT RISK - README over-claims vs. code |

---

## Prioritized punch list

### To be credible as a "concept + prototype" submission (hours)

1. Fix README tense - describe the proof pipeline as **planned**, not implemented. One honest paragraph removes the biggest risk.
2. Make the 3 dead nav tabs render real (even static) content, or hide them.
3. Unify the name across README / spec / UI. Remove `AttestCredit` / `Attestcoin` unless deliberate.
4. Add a `withdraw` / `unlock` path to `CollateralLocker` so it is not a fund trap.
5. Pin real dependency versions; delete `:Zone.Identifier` files; add `LICENSE` and `.gitignore`; `git init` and commit.
6. Record a 2-3 min demo video of the happy path - this is what most judges actually watch.

### To be credible as a "working integration" submission (days)

7. Deploy `CollateralLocker` to Sepolia; put the address + explorer link in the README.
8. Actually implement `processCollateralLock`: add `@gluwa/usc-sdk`, verify the Merkle + continuity payload via BlockProver, decode `receipt.status == 1` and the `Locked` event via EvmV1Decoder, enforce replay protection on a **derived** queryId (not caller-supplied). Deploy to Creditcoin testnet.
9. Give `Toxascore` a real lending asset (even a mock ERC-20 pool) so `processCollateralLock` disburses and `repay` collects.
10. Wire the front end to both contracts with viem/wagmi + a real wallet connector; replace the `advance()` stub with actual tx calls and status polling.
11. Add Foundry/Hardhat with tests for: replay rejection, invalid-proof rejection, LTV-by-score, repay accounting.

---

## What changed since this audit

- README rewritten to describe the proof pipeline as planned, not implemented (item 1).
- All 5 nav tabs now render real content - Credit Score, Activity, and Docs are live views, not Overview re-renders (item 2).
- Branding unified to "Toxascore" as the product name; "Attestcoin Protocol" kept only as the name of the underlying proof mechanism, never as a stand-in for the product (item 3).
- `CollateralLocker.sol` gained `unlockETH`, per-user accounting, and nonces - collateral is no longer permanently unrecoverable (item 4).
- `package.json` now pins real semver ranges instead of `"latest"`; `LICENSE` (MIT) and `.gitignore` added (item 5).
- `Toxascore.sol` now moves real value through a self-funded demo pool - `processCollateralLock` disburses and `repay` collects - instead of `repay` only flipping a boolean (partial progress on item 9). Proof verification itself (item 8) is still an open TODO, called out explicitly in the contract's NatSpec rather than implied as done.
- Fixed the dead `stage===0` branch in `Borrow` and made the score ring reflect the actual score instead of a hardcoded 87%.
- Wired the previously-installed-but-unused `@vitejs/plugin-react` via a new `vite.config.js`, restoring Fast Refresh.
- Wired the previously inert buttons ("View live proofs", "View proof", "Improve score", "View all activity", header help) to real in-app navigation instead of leaving them as no-ops.

Items 7, 8 (proof verification itself), 10, and 11 from the "days" section remain open - see the Roadmap in README.md.

---

## Update 2026-09-04

Punch-list items 8-11 are now implemented in-repo:

- `Toxascore.sol` inherits `ASCBase` and verifies Merkle + Continuity proofs via BlockProver, then decodes `Locked` with `EvmV1Decoder` (receipt status, registered locker emitter, caller/from match).
- Foundry tests cover locker accounting, log binding, LTV, issuance, and repayment.
- Frontend Live mode wires MetaMask + Sepolia lock + `/api/prove` + Creditcoin `execute`.
- Optional `npm run worker` relayer submits proofs so the user only signs the lock.

Item 7 (testnet deployment addresses) still depends on keys/faucets and is documented in README.md.
