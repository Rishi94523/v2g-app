// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

interface IV2GToken {
    function mint(address to, uint256 amount) external;
}

/**
 * @title RewardDistributor
 * @dev Distributes V2G tokens based on energy contribution proofs
 * The backend server submits batched contribution records
 */
contract RewardDistributor is Ownable {
    // The V2G token contract
    IV2GToken public v2gToken;

    // Base tokens per kWh discharged (in wei, 18 decimals)
    // Default: 10 tokens per kWh
    uint256 public baseRewardPerKwh = 10 * 10**18;

    // Peak hour multiplier (in basis points, 10000 = 1x, 20000 = 2x)
    uint256 public peakHourMultiplier = 20000; // 2x during peak hours

    // Grid emergency multiplier (in basis points)
    uint256 public emergencyMultiplier = 30000; // 3x during grid emergencies

    // Nonce to prevent replay attacks
    mapping(bytes32 => bool) public processedContributions;

    // Total tokens distributed
    uint256 public totalDistributed;

    // User statistics
    mapping(address => uint256) public userTotalEarned;
    mapping(address => uint256) public userTotalKwh;

    // Events
    event RewardDistributed(
        address indexed user,
        uint256 energyKwh,
        uint256 tokensAwarded,
        bytes32 contributionId
    );
    event MultiplierUpdated(string multiplierType, uint256 newValue);
    event BaseRewardUpdated(uint256 newValue);

    constructor(address _v2gToken) Ownable(msg.sender) {
        v2gToken = IV2GToken(_v2gToken);
    }

    /**
     * @dev Calculate reward with multipliers
     */
    function _calculateReward(uint256 energyKwh, bool wasPeakHour, bool wasEmergency) internal view returns (uint256) {
        uint256 baseReward = (energyKwh * baseRewardPerKwh) / 1000;
        uint256 multiplier = 10000; // Base 1x
        
        if (wasEmergency) {
            multiplier = emergencyMultiplier;
        } else if (wasPeakHour) {
            multiplier = peakHourMultiplier;
        }
        
        return (baseReward * multiplier) / 10000;
    }

    /**
     * @dev Distribute rewards for a single contribution
     * @param user Address of the user who contributed
     * @param energyKwh Energy discharged in kWh (scaled by 1000 for precision)
     * @param wasPeakHour Whether the contribution was during peak hours
     * @param wasEmergency Whether there was a grid emergency
     * @param contributionId Unique ID to prevent double-claiming
     */
    function distributeReward(
        address user,
        uint256 energyKwh,
        bool wasPeakHour,
        bool wasEmergency,
        bytes32 contributionId
    ) external onlyOwner {
        require(!processedContributions[contributionId], "Contribution already processed");
        require(user != address(0), "Invalid user address");
        require(energyKwh > 0, "Energy must be positive");

        processedContributions[contributionId] = true;

        uint256 finalReward = _calculateReward(energyKwh, wasPeakHour, wasEmergency);

        v2gToken.mint(user, finalReward);

        totalDistributed += finalReward;
        userTotalEarned[user] += finalReward;
        userTotalKwh[user] += energyKwh;

        emit RewardDistributed(user, energyKwh, finalReward, contributionId);
    }

    /**
     * @dev Simplified batch reward structure
     */
    struct RewardData {
        address user;
        uint256 energyKwh;
        bool wasPeakHour;
        bool wasEmergency;
        bytes32 contributionId;
    }

    /**
     * @dev Batch distribute rewards using struct array
     * @param rewards Array of reward data
     */
    function batchDistributeRewards(RewardData[] calldata rewards) external onlyOwner {
        for (uint256 i = 0; i < rewards.length; i++) {
            RewardData calldata r = rewards[i];
            
            if (processedContributions[r.contributionId]) {
                continue;
            }

            processedContributions[r.contributionId] = true;

            uint256 finalReward = _calculateReward(r.energyKwh, r.wasPeakHour, r.wasEmergency);

            v2gToken.mint(r.user, finalReward);

            totalDistributed += finalReward;
            userTotalEarned[r.user] += finalReward;
            userTotalKwh[r.user] += r.energyKwh;

            emit RewardDistributed(r.user, r.energyKwh, finalReward, r.contributionId);
        }
    }

    /**
     * @dev Update the base reward per kWh
     */
    function setBaseRewardPerKwh(uint256 newReward) external onlyOwner {
        baseRewardPerKwh = newReward;
        emit BaseRewardUpdated(newReward);
    }

    /**
     * @dev Update the peak hour multiplier
     */
    function setPeakHourMultiplier(uint256 newMultiplier) external onlyOwner {
        peakHourMultiplier = newMultiplier;
        emit MultiplierUpdated("peakHour", newMultiplier);
    }

    /**
     * @dev Update the emergency multiplier
     */
    function setEmergencyMultiplier(uint256 newMultiplier) external onlyOwner {
        emergencyMultiplier = newMultiplier;
        emit MultiplierUpdated("emergency", newMultiplier);
    }

    /**
     * @dev Get user statistics
     */
    function getUserStats(address user) external view returns (uint256 totalEarned, uint256 totalKwh) {
        return (userTotalEarned[user], userTotalKwh[user]);
    }
}
