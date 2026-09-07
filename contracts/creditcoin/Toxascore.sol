// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ASCBase} from "@gluwa/asc-contracts/contracts/readability/ASCBase.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

/**
 * @title Toxascore
 * @notice Creditcoin Attestcoin Smart Contract (ASC). Verifies that collateral was
 *         locked on Sepolia (`CollateralLocker`) via the Block Prover precompile,
 *         then issues a native-token loan and updates the borrower's portable score.
 *
 * @dev Proof verification is inherited from `ASCBase.execute`:
 *        1. Merkle inclusion + continuity via BlockProver (`0x0FD2`)
 *        2. Replay protection on (chainKey, blockHeight, txIndex)
 *        3. `_processAndEmitEvent` decodes the `Locked` event, checks receipt.status == 1,
 *           and requires the log emitter to be the registered Sepolia locker
 *
 *      Lending asset is this contract's native tCTC balance (`fundPool`). Collateral
 *      amount is treated 1:1 against tCTC for the hackathon (no price oracle).
 *
 *      Anyone may submit a valid proof. The loan is disbursed to the proven locker,
 *      not to `msg.sender` (the worker/relayer).
 */
contract Toxascore is ASCBase, Ownable, ReentrancyGuard {
    enum Actions {
        CollateralLocked // 0
    }

    error InvalidAction(uint8 action);
    error PoolUnderfunded(uint256 needed, uint256 available);

    /// @dev keccak256("Locked(address,address,uint256,uint256,uint256)")
    bytes32 public constant LOCKED_EVENT_SIGNATURE =
        0xc392e99d431032ac14a872985e1784cd90533e27608253c002a198d8e6358ed9;

    struct Loan {
        address borrower;
        uint256 principal;
        uint256 collateralAmount;
        uint256 ltvBps;
        uint256 lockNonce;
        bool repaid;
        uint256 createdAt;
        bytes32 queryId;
    }

    struct AccountView {
        uint256 score;
        uint256 ltvBps;
        uint256 activeLoanId;
        uint256 principal;
        uint256 collateralAmount;
        bool repaid;
    }

    mapping(address => uint256) public toxascore;
    mapping(uint256 => Loan) public loans;
    mapping(address => uint256) public activeLoanId;

    uint256 public nextLoanId = 1;
    address public sourceLocker;
    uint64 public sourceChainKey = 1; // Ethereum Sepolia on CC3 testnet

    uint256 public constant BASE_LTV_BPS = 6000; // 60%
    uint256 public constant MAX_LTV_BPS = 8000; // 80%
    uint256 public constant STARTING_SCORE = 700;
    uint256 public constant LOCK_SCORE_DELTA = 5;
    uint256 public constant REPAY_SCORE_DELTA = 15;
    uint256 public constant LTV_BPS_PER_SCORE_POINT = 10;

    event SourceLockerRegistered(address indexed locker);
    event SourceChainKeyUpdated(uint64 chainKey);
    event PoolFunded(address indexed funder, uint256 amount);
    event LoanIssued(
        uint256 indexed loanId,
        address indexed borrower,
        uint256 principal,
        uint256 collateralAmount,
        uint256 ltvBps,
        uint256 newScore,
        bytes32 queryId
    );
    event Repaid(uint256 indexed loanId, address indexed borrower, uint256 newScore);
    event ScoreUpdated(address indexed user, uint256 newScore);

    constructor(address locker) Ownable(msg.sender) {
        if (locker != address(0)) {
            sourceLocker = locker;
            emit SourceLockerRegistered(locker);
        }
    }

    function registerSourceLocker(address locker) external onlyOwner {
        require(locker != address(0), "locker=0");
        sourceLocker = locker;
        emit SourceLockerRegistered(locker);
    }

    function setSourceChainKey(uint64 key) external onlyOwner {
        sourceChainKey = key;
        emit SourceChainKeyUpdated(key);
    }

    function fundPool() external payable {
        require(msg.value > 0, "amount=0");
        emit PoolFunded(msg.sender, msg.value);
    }

    receive() external payable {
        emit PoolFunded(msg.sender, msg.value);
    }

    function _processAndEmitEvent(
        uint8 action,
        bytes32 queryId,
        bytes memory encodedTransaction
    ) internal override {
        if (action != uint8(Actions.CollateralLocked)) revert InvalidAction(action);
        _issueLoanFromLock(queryId, encodedTransaction);
    }

    function _issueLoanFromLock(bytes32 queryId, bytes memory encodedTransaction) internal {
        (address user, address token, uint256 amount, uint256 nonce) =
            _decodeLocked(encodedTransaction);

        require(token == address(0), "unsupported token");
        require(amount > 0, "amount=0");
        _issueLoan(user, amount, nonce, queryId);
    }

    function _issueLoan(
        address borrower,
        uint256 collateralAmount,
        uint256 nonce,
        bytes32 queryId
    ) internal {
        uint256 existing = activeLoanId[borrower];
        require(existing == 0 || loans[existing].repaid, "active loan");

        uint256 score = _scoreOf(borrower);
        uint256 ltvBps = _ltvBps(score);
        uint256 principal = (collateralAmount * ltvBps) / 10_000;
        require(principal > 0, "principal=0");
        if (address(this).balance < principal) {
            revert PoolUnderfunded(principal, address(this).balance);
        }

        uint256 loanId = nextLoanId++;
        loans[loanId] = Loan({
            borrower: borrower,
            principal: principal,
            collateralAmount: collateralAmount,
            ltvBps: ltvBps,
            lockNonce: nonce,
            repaid: false,
            createdAt: block.timestamp,
            queryId: queryId
        });
        activeLoanId[borrower] = loanId;
        toxascore[borrower] = score + LOCK_SCORE_DELTA;

        (bool sent, ) = borrower.call{value: principal}("");
        require(sent, "disbursement failed");

        emit LoanIssued(
            loanId,
            borrower,
            principal,
            collateralAmount,
            ltvBps,
            toxascore[borrower],
            queryId
        );
        emit ScoreUpdated(borrower, toxascore[borrower]);
    }

    function repay(uint256 loanId) external payable nonReentrant {
        Loan storage loan = loans[loanId];
        require(loan.borrower == msg.sender, "not borrower");
        require(!loan.repaid, "already repaid");
        require(msg.value >= loan.principal, "insufficient repayment");

        loan.repaid = true;
        toxascore[msg.sender] = _scoreOf(msg.sender) + REPAY_SCORE_DELTA;

        uint256 refund = msg.value - loan.principal;
        if (refund > 0) {
            (bool returned, ) = msg.sender.call{value: refund}("");
            require(returned, "refund failed");
        }

        emit Repaid(loanId, msg.sender, toxascore[msg.sender]);
        emit ScoreUpdated(msg.sender, toxascore[msg.sender]);
    }

    function getToxascore(address user) external view returns (uint256) {
        return _scoreOf(user);
    }

    function ltvFor(address user) external view returns (uint256) {
        return _ltvBps(_scoreOf(user));
    }

    function getAccount(address user) external view returns (AccountView memory view_) {
        uint256 score = _scoreOf(user);
        uint256 loanId = activeLoanId[user];
        view_.score = score;
        view_.ltvBps = _ltvBps(score);
        view_.activeLoanId = loanId;
        if (loanId != 0) {
            Loan storage loan = loans[loanId];
            view_.principal = loan.principal;
            view_.collateralAmount = loan.collateralAmount;
            view_.repaid = loan.repaid;
        }
    }

    function poolBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /**
     * @notice What `collateralAmount` would draw for `user` right now.
     * @dev Called by the app before the Sepolia lock, so nobody escrows ETH
     *      against a pool that cannot fund the loan.
     */
    function quoteLoan(address user, uint256 collateralAmount)
        external
        view
        returns (uint256 principal, uint256 ltvBps, bool fundable, uint256 pool)
    {
        ltvBps = _ltvBps(_scoreOf(user));
        principal = (collateralAmount * ltvBps) / 10_000;
        pool = address(this).balance;
        uint256 existing = activeLoanId[user];
        fundable = principal > 0 && pool >= principal && (existing == 0 || loans[existing].repaid);
    }

    function _scoreOf(address user) internal view returns (uint256) {
        return toxascore[user] == 0 ? STARTING_SCORE : toxascore[user];
    }

    function _ltvBps(uint256 score) internal pure returns (uint256 ltvBps) {
        ltvBps = BASE_LTV_BPS;
        if (score > STARTING_SCORE) {
            ltvBps += (score - STARTING_SCORE) * LTV_BPS_PER_SCORE_POINT;
        }
        if (ltvBps > MAX_LTV_BPS) ltvBps = MAX_LTV_BPS;
    }

    function _decodeLocked(bytes memory encodedTransaction)
        internal
        view
        returns (address user, address token, uint256 amount, uint256 nonce)
    {
        uint8 txType = EvmV1Decoder.getTransactionType(encodedTransaction);
        require(EvmV1Decoder.isValidTransactionType(txType), "bad tx type");

        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        require(receipt.receiptStatus == 1, "tx reverted");

        EvmV1Decoder.CommonTxFields memory txFields = EvmV1Decoder.decodeCommonTxFields(encodedTransaction);
        require(sourceLocker != address(0), "locker unset");
        require(txFields.to == sourceLocker, "to != locker");

        EvmV1Decoder.LogEntry[] memory logs =
            EvmV1Decoder.getLogsByEventSignature(receipt, LOCKED_EVENT_SIGNATURE);
        require(logs.length > 0, "no Locked event");

        return _processLockedLog(logs[0], txFields.from);
    }

    function _processLockedLog(EvmV1Decoder.LogEntry memory log, address txFrom)
        internal
        view
        returns (address user, address token, uint256 amount, uint256 nonce)
    {
        require(sourceLocker != address(0), "locker unset");
        require(log.address_ == sourceLocker, "bad emitter");
        require(log.topics.length == 3, "bad topics");
        require(log.topics[0] == LOCKED_EVENT_SIGNATURE, "not Locked");
        require(log.data.length == 96, "bad data");

        user = address(uint160(uint256(log.topics[1])));
        token = address(uint160(uint256(log.topics[2])));
        require(user == txFrom, "from != locker user");

        (amount, nonce, ) = abi.decode(log.data, (uint256, uint256, uint256));
    }
}
