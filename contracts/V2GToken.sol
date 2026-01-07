// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title V2GToken
 * @dev ERC-20 token for rewarding V2G (Vehicle to Grid) contributions
 * Users earn tokens when they discharge their EV batteries to the grid
 */
contract V2GToken is ERC20, Ownable {
    // Address authorized to mint tokens (the RewardDistributor contract)
    address public distributor;

    // Events
    event DistributorUpdated(address indexed oldDistributor, address indexed newDistributor);
    event TokensMinted(address indexed to, uint256 amount);

    constructor() ERC20("V2G Token", "V2G") Ownable(msg.sender) {}

    /**
     * @dev Set the distributor address that can mint tokens
     * @param _distributor Address of the RewardDistributor contract
     */
    function setDistributor(address _distributor) external onlyOwner {
        address oldDistributor = distributor;
        distributor = _distributor;
        emit DistributorUpdated(oldDistributor, _distributor);
    }

    /**
     * @dev Mint tokens to a user (only callable by distributor)
     * @param to Address to mint tokens to
     * @param amount Amount of tokens to mint (in wei, 18 decimals)
     */
    function mint(address to, uint256 amount) external {
        require(msg.sender == distributor, "V2GToken: caller is not the distributor");
        _mint(to, amount);
        emit TokensMinted(to, amount);
    }

    /**
     * @dev Get the number of decimals (18, standard for ERC-20)
     */
    function decimals() public pure override returns (uint8) {
        return 18;
    }
}
