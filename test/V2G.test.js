const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("V2G Contracts", function () {
    let v2gToken;
    let rewardDistributor;
    let owner;
    let user1;
    let user2;

    beforeEach(async function () {
        [owner, user1, user2] = await ethers.getSigners();

        // Deploy V2GToken
        const V2GToken = await ethers.getContractFactory("V2GToken");
        v2gToken = await V2GToken.deploy();
        await v2gToken.waitForDeployment();

        // Deploy RewardDistributor
        const RewardDistributor = await ethers.getContractFactory("RewardDistributor");
        rewardDistributor = await RewardDistributor.deploy(await v2gToken.getAddress());
        await rewardDistributor.waitForDeployment();

        // Set distributor
        await v2gToken.setDistributor(await rewardDistributor.getAddress());
    });

    describe("V2GToken", function () {
        it("Should have correct name and symbol", async function () {
            expect(await v2gToken.name()).to.equal("V2G Token");
            expect(await v2gToken.symbol()).to.equal("V2G");
        });

        it("Should have 18 decimals", async function () {
            expect(await v2gToken.decimals()).to.equal(18);
        });

        it("Should only allow distributor to mint", async function () {
            await expect(
                v2gToken.connect(user1).mint(user1.address, 1000)
            ).to.be.revertedWith("V2GToken: caller is not the distributor");
        });
    });

    describe("RewardDistributor", function () {
        it("Should distribute rewards correctly", async function () {
            const energyKwh = 5000; // 5 kWh (scaled by 1000)
            const contributionId = ethers.keccak256(ethers.toUtf8Bytes("contribution-1"));

            await rewardDistributor.distributeReward(
                user1.address,
                energyKwh,
                false, // not peak hour
                false, // not emergency
                contributionId
            );

            // 5 kWh * 10 tokens/kWh = 50 tokens
            const expectedTokens = ethers.parseEther("50");
            expect(await v2gToken.balanceOf(user1.address)).to.equal(expectedTokens);
        });

        it("Should apply peak hour multiplier (2x)", async function () {
            const energyKwh = 5000; // 5 kWh
            const contributionId = ethers.keccak256(ethers.toUtf8Bytes("contribution-2"));

            await rewardDistributor.distributeReward(
                user1.address,
                energyKwh,
                true, // peak hour
                false,
                contributionId
            );

            // 5 kWh * 10 tokens * 2x = 100 tokens
            const expectedTokens = ethers.parseEther("100");
            expect(await v2gToken.balanceOf(user1.address)).to.equal(expectedTokens);
        });

        it("Should apply emergency multiplier (3x)", async function () {
            const energyKwh = 5000; // 5 kWh
            const contributionId = ethers.keccak256(ethers.toUtf8Bytes("contribution-3"));

            await rewardDistributor.distributeReward(
                user1.address,
                energyKwh,
                false,
                true, // emergency
                contributionId
            );

            // 5 kWh * 10 tokens * 3x = 150 tokens
            const expectedTokens = ethers.parseEther("150");
            expect(await v2gToken.balanceOf(user1.address)).to.equal(expectedTokens);
        });

        it("Should prevent double claiming", async function () {
            const contributionId = ethers.keccak256(ethers.toUtf8Bytes("contribution-4"));

            await rewardDistributor.distributeReward(user1.address, 5000, false, false, contributionId);

            await expect(
                rewardDistributor.distributeReward(user1.address, 5000, false, false, contributionId)
            ).to.be.revertedWith("Contribution already processed");
        });

        it("Should batch distribute rewards", async function () {
            const contribution1 = ethers.keccak256(ethers.toUtf8Bytes("batch-1"));
            const contribution2 = ethers.keccak256(ethers.toUtf8Bytes("batch-2"));

            // Use struct array format
            await rewardDistributor.batchDistributeRewards([
                {
                    user: user1.address,
                    energyKwh: 5000,
                    wasPeakHour: false,
                    wasEmergency: false,
                    contributionId: contribution1
                },
                {
                    user: user2.address,
                    energyKwh: 10000,
                    wasPeakHour: true,
                    wasEmergency: false,
                    contributionId: contribution2
                }
            ]);

            // User1: 5 kWh * 10 tokens = 50 tokens
            // User2: 10 kWh * 10 tokens * 2x = 200 tokens
            expect(await v2gToken.balanceOf(user1.address)).to.equal(ethers.parseEther("50"));
            expect(await v2gToken.balanceOf(user2.address)).to.equal(ethers.parseEther("200"));
        });

        it("Should track user statistics", async function () {
            const contributionId = ethers.keccak256(ethers.toUtf8Bytes("stats-test"));

            await rewardDistributor.distributeReward(user1.address, 5000, false, false, contributionId);

            const [totalEarned, totalKwh] = await rewardDistributor.getUserStats(user1.address);
            expect(totalEarned).to.equal(ethers.parseEther("50"));
            expect(totalKwh).to.equal(5000);
        });
    });
});
