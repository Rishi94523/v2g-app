/* eslint-disable @typescript-eslint/no-require-imports */
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    console.log("Deploying V2G contracts...\n");

    // Get the deployer account
    const [deployer] = await hre.ethers.getSigners();
    const network = await hre.ethers.provider.getNetwork();
    console.log("Deploying with account:", deployer.address);
    console.log("Account balance:", (await hre.ethers.provider.getBalance(deployer.address)).toString());
    console.log();

    // Deploy V2GToken
    console.log("1. Deploying V2GToken...");
    const V2GToken = await hre.ethers.getContractFactory("V2GToken");
    const v2gToken = await V2GToken.deploy();
    await v2gToken.waitForDeployment();
    const v2gTokenAddress = await v2gToken.getAddress();
    console.log("   V2GToken deployed to:", v2gTokenAddress);

    // Deploy RewardDistributor
    console.log("\n2. Deploying RewardDistributor...");
    const RewardDistributor = await hre.ethers.getContractFactory("RewardDistributor");
    const rewardDistributor = await RewardDistributor.deploy(v2gTokenAddress);
    await rewardDistributor.waitForDeployment();
    const distributorAddress = await rewardDistributor.getAddress();
    console.log("   RewardDistributor deployed to:", distributorAddress);

    // Set the distributor in the token contract
    console.log("\n3. Setting distributor in V2GToken...");
    const tx = await v2gToken.setDistributor(distributorAddress);
    await tx.wait();
    console.log("   Distributor set successfully!");

    // Print summary
    console.log("\n" + "=".repeat(50));
    console.log("DEPLOYMENT SUMMARY");
    console.log("=".repeat(50));
    console.log(`V2GToken:          ${v2gTokenAddress}`);
    console.log(`RewardDistributor: ${distributorAddress}`);
    console.log(`Network:           ${hre.network.name}`);
    console.log("=".repeat(50));

    const deploymentDir = path.join(__dirname, "..", "contracts", "deployments");
    fs.mkdirSync(deploymentDir, { recursive: true });
    const deploymentPath = path.join(deploymentDir, `${hre.network.name}.json`);
    fs.writeFileSync(
        deploymentPath,
        JSON.stringify(
            {
                network: hre.network.name,
                chainId: Number(network.chainId),
                rpcUrl: hre.network.config.url || null,
                deployedAt: new Date().toISOString(),
                deployer: deployer.address,
                contracts: {
                    V2GToken: v2gTokenAddress,
                    RewardDistributor: distributorAddress,
                },
            },
            null,
            2
        )
    );
    console.log(`Deployment record: ${deploymentPath}`);

    // Verify instructions for Sepolia
    if (hre.network.name === "sepolia") {
        console.log("\nTo verify on Etherscan, run:");
        console.log(`npx hardhat verify --network sepolia ${v2gTokenAddress}`);
        console.log(`npx hardhat verify --network sepolia ${distributorAddress} "${v2gTokenAddress}"`);
    }

    return {
        v2gToken: v2gTokenAddress,
        rewardDistributor: distributorAddress,
    };
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
