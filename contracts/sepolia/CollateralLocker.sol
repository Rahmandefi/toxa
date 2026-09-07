// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title CollateralLocker
 * @notice Sepolia-side collateral escrow for Toxa. Emits a `Locked` event that
 *         an Attestcoin proof pipeline attests to Creditcoin.
 * @dev Collateral is escrowed, not parked: `unlockETH` needs a release voucher
 *      signed by `releaser`, the relayer that watches Toxascore on Creditcoin and
 *      only signs once the borrower has no unrepaid loan. Sepolia cannot verify a
 *      Creditcoin state proof (BlockProver runs on the Creditcoin side only), so
 *      the release leg is signature-attested rather than proof-verified.
 *
 *      `emergencyUnlock` is the escape hatch: after `RELEASE_TIMEOUT` from the
 *      user's last lock, funds come back with no voucher, so a silent or lost
 *      releaser key can never strand collateral.
 */
contract CollateralLocker is Ownable, ReentrancyGuard {
    event Locked(
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 nonce,
        uint256 timestamp
    );

    event Unlocked(address indexed user, uint256 amount, uint256 nonce);
    event EmergencyUnlocked(address indexed user, uint256 amount, uint256 nonce);
    event ReleaserUpdated(address indexed releaser);

    mapping(address => uint256) public lockedETH;
    mapping(address => uint256) public nonces;
    /// @notice Consumed release vouchers, one counter per user.
    mapping(address => uint256) public releaseNonce;
    /// @notice Timestamp of the user's most recent lock, the emergency clock.
    mapping(address => uint256) public lastLockAt;

    /// @notice Key allowed to sign release vouchers (the Toxa relayer).
    address public releaser;

    /// @notice How long after a lock the user may withdraw without a voucher.
    uint256 public constant RELEASE_TIMEOUT = 30 days;

    bytes32 public constant RELEASE_TYPEHASH =
        keccak256("ToxaRelease(address user,uint256 amount,uint256 nonce,uint256 deadline,uint256 chainId,address locker)");

    constructor(address releaser_) Ownable(msg.sender) {
        if (releaser_ != address(0)) {
            releaser = releaser_;
            emit ReleaserUpdated(releaser_);
        }
    }

    function setReleaser(address releaser_) external onlyOwner {
        require(releaser_ != address(0), "releaser=0");
        releaser = releaser_;
        emit ReleaserUpdated(releaser_);
    }

    function lockETH() external payable nonReentrant returns (uint256 nonce) {
        require(msg.value > 0, "amount=0");
        nonce = nonces[msg.sender]++;
        lockedETH[msg.sender] += msg.value;
        lastLockAt[msg.sender] = block.timestamp;

        emit Locked(msg.sender, address(0), msg.value, nonce, block.timestamp);
    }

    /**
     * @notice Withdraw collateral against a release voucher.
     * @param amount Wei to withdraw, at most the caller's locked balance.
     * @param deadline Unix time after which the voucher is dead.
     * @param signature `releaser` signature over `releaseDigest(...)`.
     */
    function unlockETH(uint256 amount, uint256 deadline, bytes calldata signature) external nonReentrant {
        require(amount > 0, "amount=0");
        require(lockedETH[msg.sender] >= amount, "insufficient locked");
        require(block.timestamp <= deadline, "voucher expired");
        require(releaser != address(0), "releaser unset");

        bytes32 digest = releaseDigest(msg.sender, amount, releaseNonce[msg.sender], deadline);
        require(ECDSA.recover(digest, signature) == releaser, "bad voucher");

        uint256 nonce = releaseNonce[msg.sender]++;
        lockedETH[msg.sender] -= amount;

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "transfer failed");

        emit Unlocked(msg.sender, amount, nonce);
    }

    /**
     * @notice Withdraw without a voucher, once the release timeout has passed.
     * @dev Guarantees collateral is never stranded by an unreachable releaser.
     */
    function emergencyUnlock(uint256 amount) external nonReentrant {
        require(amount > 0, "amount=0");
        require(lockedETH[msg.sender] >= amount, "insufficient locked");
        require(block.timestamp >= lastLockAt[msg.sender] + RELEASE_TIMEOUT, "timeout pending");

        uint256 nonce = releaseNonce[msg.sender]++;
        lockedETH[msg.sender] -= amount;

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "transfer failed");

        emit EmergencyUnlocked(msg.sender, amount, nonce);
    }

    /// @notice Digest a releaser signs to authorise one withdrawal.
    function releaseDigest(address user, uint256 amount, uint256 nonce, uint256 deadline)
        public
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(RELEASE_TYPEHASH, user, amount, nonce, deadline, block.chainid, address(this))
        );
        return MessageHashUtils.toEthSignedMessageHash(structHash);
    }

    function getLocked(address user) external view returns (uint256) {
        return lockedETH[user];
    }

    /// @notice When `user` may call `emergencyUnlock`, 0 if they hold no collateral.
    function emergencyUnlockAt(address user) external view returns (uint256) {
        if (lockedETH[user] == 0) return 0;
        return lastLockAt[user] + RELEASE_TIMEOUT;
    }
}
