# V2G Smart Contracts

Ethereum smart contracts for the V2G token reward system.

## Contracts

### V2GToken.sol
ERC-20 token that rewards users for V2G participation.

- **Symbol**: V2G
- **Network**: Ethereum Sepolia (testnet)
- **Features**: Mintable by RewardDistributor

### RewardDistributor.sol
Distributes V2G tokens based on grid contributions.

- Tracks device contributions
- Calculates rewards based on energy discharged during grid stress
- Integrates with Supabase for contribution logging

## Deployment (Future)

```bash
# Install Hardhat dependencies
npm install

# Compile contracts
npx hardhat compile

# Deploy to Sepolia
npx hardhat run scripts/deploy.js --network sepolia
```

## Environment Variables

```env
SEPOLIA_RPC_URL=https://rpc.sepolia.org
PRIVATE_KEY=your_wallet_private_key
```

## Status

⏳ **Paused** - Blockchain integration planned for Phase 6 after core V2G logic is complete.
