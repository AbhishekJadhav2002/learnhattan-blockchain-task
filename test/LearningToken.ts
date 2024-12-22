import { time } from "@nomicfoundation/hardhat-network-helpers";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ContractTransactionReceipt, EventLog, Result } from "ethers";
import hre, { ethers } from "hardhat";
import LearningTokenModule from "../ignition/modules/LearningToken";
import { LearningToken } from "../types/contracts";

async function deployLearningTokenFixture() {
  const [owner, alice, bob, carol, david, eva] = await hre.ethers.getSigners();
  const { learningToken } = await hre.ignition.deploy(LearningTokenModule, { defaultSender: owner.address }) as unknown as { learningToken: LearningToken };

  const INITIAL_SUPPLY = await learningToken.INITIAL_SUPPLY();
  const REWARD_POOL = await learningToken.REWARD_POOL();
  const MIN_STAKE_DURATION = await learningToken.MIN_STAKE_DURATION();
  const VOTER_REWARD_PERCENTAGE = await learningToken.VOTER_REWARD_PERCENTAGE();

  return {
    learningToken,
    owner,
    alice,
    bob,
    carol,
    david,
    eva,
    users: [alice, bob, carol, david, eva],
    INITIAL_SUPPLY,
    REWARD_POOL,
    MIN_STAKE_DURATION,
    VOTER_REWARD_PERCENTAGE,
  };
}

const oneDay = 24 * 60 * 60;

describe("LearningToken", function () {
  describe("Token Basics", function () {
    it("Should set the right owner", async function () {
      const { learningToken, owner } = await loadFixture(deployLearningTokenFixture);

      const _owner = await learningToken.owner();
      expect(_owner).to.equal(owner.address);
    });

    it("Should set correct initial token distribution", async function () {
      const { learningToken, owner, INITIAL_SUPPLY, REWARD_POOL } = await loadFixture(deployLearningTokenFixture);

      expect(await learningToken.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY - REWARD_POOL);
      expect(await learningToken.balanceOf(learningToken.target)).to.equal(REWARD_POOL);
    });
  });

  describe("Token Transfer Tests", function () {
    it("Should revert if recipient is zero address", async function () {
      const { learningToken } = await loadFixture(deployLearningTokenFixture);

      await expect(learningToken.transfer("0x0000000000000000000000000000000000000000", 100)).to.be.revertedWithCustomError(learningToken, "ERC20InvalidReceiver").withArgs("0x0000000000000000000000000000000000000000");
    });

    it("Should transfer tokens correctly", async function () {
      const { learningToken, alice } = await loadFixture(deployLearningTokenFixture);
      const amount = ethers.parseEther("1000");

      await learningToken.transfer(alice.address, amount);

      const receiptBalance = await learningToken.balanceOf(alice.address);
      expect(receiptBalance).to.equal(amount);
    });

    it("Should fail if sender doesn't have enough tokens", async function () {
      const { learningToken, owner, alice } = await loadFixture(deployLearningTokenFixture);
      const amount = ethers.parseEther("1000");

      await expect(learningToken.connect(alice).transfer(owner.address, amount)).to.be.revertedWithCustomError(learningToken, "ERC20InsufficientBalance").withArgs(alice.address, 0, amount);
    });

    it("Should update balances after transfers", async function () {
      const { learningToken, owner, alice } = await loadFixture(deployLearningTokenFixture);
      const initialSupply = await learningToken.INITIAL_SUPPLY();
      const amount = ethers.parseEther("1000");

      await learningToken.transfer(alice.address, amount);

      const ownerBalance = await learningToken.balanceOf(owner.address);
      const aliceBalance = await learningToken.balanceOf(alice.address);
      const totalSupply = await learningToken.totalSupply();

      expect(ownerBalance).to.equal(initialSupply / BigInt(2) - amount);
      expect(aliceBalance).to.equal(amount);
      expect(totalSupply).to.equal(initialSupply);
    });

    it("Should holder be able to approve", async () => {
      const { learningToken, owner, alice } = await loadFixture(deployLearningTokenFixture);
      const amount = ethers.parseEther("1000");

      await learningToken.approve(alice.address, amount);

      const recipientAllowance = await learningToken.allowance(owner.address, alice.address);
      expect(recipientAllowance).to.be.equal(amount);
    });

    it("Should be able to transfer after approve", async () => {
      const { learningToken, owner, alice } = await loadFixture(deployLearningTokenFixture);
      const amount = ethers.parseEther("1000");

      await learningToken.approve(alice.address, amount);

      await expect(learningToken.connect(alice).transferFrom(owner.address, alice.address, amount))
        .to.emit(learningToken, 'Transfer')
        .withArgs(owner.address, alice.address, amount);
    });

    it("Should not be able to transfer without approval", async () => {
      const { learningToken, owner, alice } = await loadFixture(deployLearningTokenFixture);
      const amount = ethers.parseEther("1000");

      await expect(learningToken.connect(alice).transferFrom(owner.address, alice.address, amount)).to.be.revertedWithCustomError(learningToken, "ERC20InsufficientAllowance").withArgs(alice.address, 0, amount);
    });
  });

  describe("Staking Mechanism", function () {
    it("Should allow users to stake tokens", async function () {
      const { learningToken, owner, alice } = await loadFixture(deployLearningTokenFixture);
      const stakeAmount = hre.ethers.parseEther("1000");

      await learningToken.connect(owner).transfer(alice.address, stakeAmount);

      await learningToken.connect(alice).stakeTokens(stakeAmount);

      const stake = await learningToken.getStake(alice.address);
      expect(stake.amount).to.equal(stakeAmount);
    });

    it("Should prevent unstaking before minimum duration", async function () {
      const { learningToken, owner, alice } = await loadFixture(deployLearningTokenFixture);
      const stakeAmount = hre.ethers.parseEther("1000");

      await learningToken.connect(owner).transfer(alice.address, stakeAmount);
      await learningToken.connect(alice).stakeTokens(stakeAmount);

      await expect(learningToken.connect(alice).unstakeTokens())
        .to.be.revertedWith("LHT: Minimum staking period not met");
    });

    it("Should allow unstaking after minimum duration", async function () {
      const { learningToken, owner, alice, MIN_STAKE_DURATION } = await loadFixture(deployLearningTokenFixture);
      const stakeAmount = hre.ethers.parseEther("1000");

      await learningToken.connect(owner).transfer(alice.address, stakeAmount);
      await learningToken.connect(alice).stakeTokens(stakeAmount);

      await time.increase(MIN_STAKE_DURATION);

      await learningToken.connect(alice).unstakeTokens();
      expect(await learningToken.balanceOf(alice.address)).to.equal(stakeAmount);
    });
  });

  describe("Quest Management", function () {
    const questArgs = {
      description: "Build a DeFi protocol",
      rewardPool: hre.ethers.parseEther("1000"),
      votingDuration: 7 * oneDay,
      topParticipants: 3,
    }
    const questId = 0;

    const solutionArgs = {
      githubLink: "https://github.com/example/solution",
      websiteLink: "https://example.com",
    };
    const solutionId = 0;

    it("Should create quest with valid parameters", async function () {
      const { learningToken, owner } = await loadFixture(deployLearningTokenFixture);

      await expect(learningToken.connect(owner).createQuest(
        questArgs.description,
        questArgs.rewardPool,
        questArgs.votingDuration,
        questArgs.topParticipants
      )).to.emit(learningToken, "QuestCreated").withArgs(questId, questArgs.description, questArgs.rewardPool, questArgs.votingDuration, questArgs.topParticipants);

      const currentBlockTimeStamp = await time.latest();

      const quest = await learningToken.getQuest(questId);
      expect(quest.description).to.equal(questArgs.description);
      expect(quest.rewardPool).to.equal(questArgs.rewardPool);
      expect(quest.votingDuration).to.equal(questArgs.votingDuration);
      expect(quest.endTime).to.equal(currentBlockTimeStamp + questArgs.votingDuration);
      expect(quest.topParticipants).to.equal(questArgs.topParticipants);
      expect(quest.isClosed).to.equal(false);
      expect(quest.totalVotingWeight).to.equal(0);
    });

    it("Should allow solution submissions", async function () {
      const { learningToken, owner, alice } = await loadFixture(deployLearningTokenFixture);

      await learningToken.connect(owner).createQuest(
        questArgs.description,
        questArgs.rewardPool,
        questArgs.votingDuration,
        questArgs.topParticipants
      );

      await expect(learningToken.connect(alice).submitSolution(
        questId,
        solutionArgs.githubLink,
        solutionArgs.websiteLink
      )).to.emit(learningToken, "SolutionSubmitted").withArgs(questId, solutionId, alice.address, solutionArgs.githubLink, solutionArgs.websiteLink);

      const currentBlockTimeStamp = await time.latest();

      const solution = await learningToken.getQuestSolution(questId, solutionId);
      expect(solution.participant).to.equal(alice.address);
      expect(solution.githubLink).to.equal(solutionArgs.githubLink);
      expect(solution.websiteLink).to.equal(solutionArgs.websiteLink);
      expect(solution.votes).to.equal(0);
      expect(solution.submissionTime).to.equal(currentBlockTimeStamp);
    });
  });

  describe("Voting and Rewards", function () {
    const questArgs = {
      description: "Build a DeFi protocol",
      rewardPool: hre.ethers.parseEther("1000"),
      votingDuration: 7 * oneDay,
      topParticipants: 3,
    }
    const questId = 0;

    const solutionArgs = {
      githubLink: "https://github.com/example/solution",
      websiteLink: "https://example.com",
    };
    const solutionId = 0;

    async function calculateVotingWeight(learningToken: LearningToken, userAddress: string) {
      const userStake = await learningToken.getStake(userAddress);
      const currentBlockTimeStamp = await time.latest();

      return userStake.amount * (BigInt(currentBlockTimeStamp) - userStake.startTime) / BigInt(oneDay);
    }

    function findEventArgs(txReceipt: ContractTransactionReceipt, eventName: string) {
      let _event: Result | null = null;

      for (const event of txReceipt.logs) {
        if (event instanceof EventLog && event.fragment && event.fragment.name === eventName) {
          _event = event.args;
        }
      }
      return _event
    }

    const weightDifferenceTolerance = hre.ethers.parseEther("0.1");

    it("Should calculate voting weight correctly", async function () {
      const { learningToken, owner, alice, bob } = await loadFixture(deployLearningTokenFixture);
      const stakeAmount = hre.ethers.parseEther("1000");

      await learningToken.connect(owner).transfer(alice.address, stakeAmount);
      await learningToken.connect(alice).stakeTokens(stakeAmount);

      await learningToken.connect(owner).createQuest(
        questArgs.description,
        questArgs.rewardPool,
        questArgs.votingDuration,
        questArgs.topParticipants
      );

      await learningToken.connect(bob).submitSolution(
        questId,
        solutionArgs.githubLink,
        solutionArgs.websiteLink
      );

      await time.increase(2 * oneDay); // 2 days passed

      const prevTotalVotingWeight = (await learningToken.getQuest(questId)).totalVotingWeight;
      const expectedUserVotingWeight = await calculateVotingWeight(learningToken, alice.address);

      const txPromise = learningToken.connect(alice).vote(questId, solutionId);
      await expect(txPromise).to.emit(learningToken, "VoteCast");
      const txReceipt = await (await txPromise).wait();
      if (!txReceipt) {
        throw new Error("Vote transaction failed");
      }
      const voteEventArgs = findEventArgs(txReceipt, "VoteCast");
      if (!voteEventArgs) {
        throw new Error("VoteCast event not found");
      }

      expect(voteEventArgs[0]).to.equal(questId);
      expect(voteEventArgs[1]).to.equal(alice.address);
      expect(voteEventArgs[2]).to.equal(solutionId);
      expect(voteEventArgs[3]).to.be.closeTo(
        expectedUserVotingWeight,
        weightDifferenceTolerance,
        "User voting weight should be within tolerance"
      );

      const solution = await learningToken.getQuestSolution(questId, solutionId);
      const quest = await learningToken.getQuest(questId);
      const userVotingWeight = await learningToken.getUserVotingWeight(questId, alice.address);
      const questVoters = await learningToken.getQuestVoters(questId);
      expect(solution.votes).to.be.gt(0);
      expect(quest.totalVotingWeight).to.closeTo(prevTotalVotingWeight + expectedUserVotingWeight, weightDifferenceTolerance, "Total voting weight should be within tolerance");
      expect(userVotingWeight).to.closeTo(expectedUserVotingWeight, weightDifferenceTolerance, "User voting weight should be within tolerance");
      expect(questVoters).to.include(alice.address);
    });

    it("Should distribute rewards correctly", async function () {
      const { learningToken, owner, alice, bob, carol, VOTER_REWARD_PERCENTAGE } = await loadFixture(deployLearningTokenFixture);
      const stakeAmount = hre.ethers.parseEther("1000");
      const questReward = hre.ethers.parseEther("10000");
      const topParticipants = 2;

      const initialBalances = {
        alice: await learningToken.balanceOf(alice.address),
        bob: await learningToken.balanceOf(bob.address),
        carol: await learningToken.balanceOf(carol.address),
        contract: await learningToken.balanceOf(learningToken.target)
      };

      await learningToken.connect(owner).createQuest(
        questArgs.description,
        questReward,
        questArgs.votingDuration,
        topParticipants
      );

      await learningToken.connect(bob).submitSolution(questId, "github.com/bob", "bob-defi.com");
      await learningToken.connect(carol).submitSolution(questId, "github.com/carol", "carol-defi.com");

      const bobSolutionId = 0;

      await learningToken.connect(owner).transfer(alice.address, stakeAmount);
      await learningToken.connect(alice).stakeTokens(stakeAmount);

      await learningToken.connect(alice).vote(questId, bobSolutionId);

      const aliceVotingWeight = await calculateVotingWeight(learningToken, alice.address);

      const bobSolution = await learningToken.getQuestSolution(questId, bobSolutionId);
      expect(bobSolution.votes).to.equal(aliceVotingWeight);

      await time.increase(questArgs.votingDuration + oneDay);

      const distributeTx = await learningToken.connect(owner).distributeRewards(questId);
      const distributeReceipt = await distributeTx.wait();
      if (!distributeReceipt) throw new Error("Distribute rewards transaction failed");

      const rewardEvent = findEventArgs(distributeReceipt, "RewardsDistributed");
      if (!rewardEvent) throw new Error("RewardsDistributed event not found");

      const finalBalances = {
        alice: await learningToken.balanceOf(alice.address),
        bob: await learningToken.balanceOf(bob.address),
        carol: await learningToken.balanceOf(carol.address),
        contract: await learningToken.balanceOf(learningToken.target)
      };

      const quest = await learningToken.getQuest(questId);
      expect(quest.isClosed).to.be.true;
      expect(quest.totalVotingWeight).to.equal(aliceVotingWeight);

      const voterRewardPool = questReward * BigInt(VOTER_REWARD_PERCENTAGE) / BigInt(100);
      const participantRewardPool = questReward - voterRewardPool;
      const expectedParticipantReward = participantRewardPool / BigInt(topParticipants);
      const expectedAliceReward = voterRewardPool * aliceVotingWeight / quest.totalVotingWeight;

      expect(finalBalances.bob - initialBalances.bob)
        .to.equal(expectedParticipantReward, "Bob should receive correct participant reward");

      expect(finalBalances.alice - initialBalances.alice)
        .to.equal(expectedAliceReward, "Alice should receive correct voter reward");

      expect(finalBalances.carol - initialBalances.carol)
        .to.equal(0, "Carol should not receive rewards, as her solution was not voted by anyone");

      let expectedContractBalanceChange = BigInt(0);
      [bob].forEach(() => {
        expectedContractBalanceChange += expectedParticipantReward;
      });
      expectedContractBalanceChange += expectedAliceReward;
      expect((initialBalances.contract + stakeAmount) - finalBalances.contract)
        .to.equal(expectedContractBalanceChange, "Contract balance should decrease by total reward amount");

      expect(rewardEvent[0]).to.equal(questId);
      expect(rewardEvent[1]).to.equal(expectedParticipantReward);
      expect(rewardEvent[2]).to.equal(voterRewardPool);

      const solutions = [
        await learningToken.getQuestSolution(questId, 0),
        await learningToken.getQuestSolution(questId, 1)
      ];
      expect(solutions[0].votes).to.be.gt(solutions[1].votes, "Bob's solution should have more votes");
    });
  });
});

describe("LearningToken Real-world Scenario", function () {
  it("Should simulate a complete quest lifecycle", async function () {
    const { learningToken, owner, alice, bob, carol, david, eva } = await loadFixture(deployLearningTokenFixture);

    const userDetails = {
      [alice.address]: "Alice",
      [bob.address]: "Bob",
      [carol.address]: "Carol",
      [david.address]: "David",
      [eva.address]: "Eva"
    }

    console.log("\n=== Starting Quest Lifecycle Simulation ===\n");

    const distribution = hre.ethers.parseEther("10000");
    for (const user of [alice, bob, carol, david, eva]) {
      await learningToken.connect(owner).transfer(user.address, distribution);
      console.log(`Distributed ${hre.ethers.formatEther(distribution)} LHT to ${userDetails[user.address]}`);
    }

    const questReward = hre.ethers.parseEther("50000");
    const votingDuration = 7 * oneDay;
    await learningToken.connect(owner).createQuest(
      "Build a Cross-chain DEX",
      questReward,
      votingDuration,
      3
    );
    console.log("\nQuest created: Build a Cross-chain DEX");
    console.log(`Reward pool: ${hre.ethers.formatEther(questReward)} LHT`);

    const stakeAmount = hre.ethers.parseEther("5000");
    for (const user of [alice, bob, carol]) {
      await learningToken.connect(user).stakeTokens(stakeAmount);
      console.log(`${userDetails[user.address]} staked ${hre.ethers.formatEther(stakeAmount)} LHT`);
    }

    const solutions = [
      { user: david, github: "github.com/david/crosschain-dex", website: "david-dex.com" },
      { user: eva, github: "github.com/eva/dex-protocol", website: "eva-dex.com" },
      { user: bob, github: "github.com/bob/unified-dex", website: "bob-dex.com" }
    ];

    for (const solution of solutions) {
      await learningToken.connect(solution.user).submitSolution(
        0,
        solution.github,
        solution.website
      );
      console.log(`\n${userDetails[solution.user.address]} submitted solution`);
    }

    await time.increase(2 * oneDay);

    await learningToken.connect(alice).vote(0, 0);
    await learningToken.connect(carol).vote(0, 1);
    await learningToken.connect(bob).vote(0, 2);

    console.log(`\nAlice voted for ${userDetails[solutions[0].user.address]}`);
    console.log(`Carol voted for ${userDetails[solutions[1].user.address]}`);
    console.log(`Bob voted for ${userDetails[solutions[2].user.address]}`);

    await time.increase(5 * oneDay); // end of quest duration

    const balancesBefore: { [address: string]: bigint } = {};
    for (const user of [alice, bob, carol, david, eva]) {
      balancesBefore[user.address] = await learningToken.balanceOf(user.address);
    }

    console.log("\n=== Owner Distributing Rewards ===");
    await learningToken.connect(owner).distributeRewards(0);

    for (const user of [alice, bob, carol, david, eva]) {
      const balanceAfter = await learningToken.balanceOf(user.address);
      const reward = balanceAfter - balancesBefore[user.address];
      console.log(`${userDetails[user.address]} received ${hre.ethers.formatEther(reward)} LHT`);
    }

    console.log("\n=== Quest Simulation Completed ===\n");
  });
});