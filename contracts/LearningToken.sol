// contracts/LearningToken.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./library/SafeMath.sol";

/**
 * @title LearningToken
 * @author Abhishek Jadhav <www.abhishek3jadhav@gmail.com>
 */
contract LearningToken is ERC20, ERC20Burnable, ReentrancyGuard, Ownable {
    using SafeERC20 for ERC20;
    using SafeMath for uint256;

    // Events
    event QuestCreated(
        uint256 indexed questId,
        string description,
        uint256 rewardPool,
        uint256 votingDuration,
        uint256 topParticipants
    );
    event SolutionSubmitted(
        uint256 indexed questId,
        uint256 solutionId,
        address indexed participant,
        string githubLink,
        string websiteLink
    );
    event VoteCast(
        uint256 indexed questId,
        address indexed voter,
        uint256 solutionId,
        uint256 weight
    );
    event RewardsDistributed(
        uint256 indexed questId,
        uint256 participantRewards,
        uint256 voterRewards
    );
    event TokensStaked(address indexed staker, uint256 amount);
    event TokensUnstaked(address indexed staker, uint256 amount);

    struct Quest {
        string description;
        uint256 rewardPool;
        uint256 votingDuration;
        uint256 endTime;
        uint256 topParticipants;
        bool isClosed;
        uint256 totalVotingWeight;
    }

    struct Solution {
        address participant;
        string githubLink;
        string websiteLink;
        uint256 votes;
        uint256 submissionTime;
    }

    struct Stake {
        uint256 amount;
        uint256 startTime;
        uint256 lastUpdateTime;
    }

    // Constants
    uint256 public constant INITIAL_SUPPLY = 1_000_000 * 10 ** 18;
    uint256 public constant REWARD_POOL = INITIAL_SUPPLY / 2;
    uint256 public constant MIN_STAKE_DURATION = 1 days;
    uint256 public constant VOTER_REWARD_PERCENTAGE = 10; // 10% of quest rewards to voters

    // State variables
    uint256 private questIdCounter;
    mapping(uint256 => Quest) public quests;
    mapping(uint256 => Solution[]) public questSolutions;
    mapping(uint256 => address[]) public questVoters;
    mapping(address => Stake) public stakes;
    mapping(uint256 => mapping(address => uint256)) public userVotingWeight;

    constructor()
        ERC20("LearningToken", "LHT")
        ERC20Burnable()
        Ownable(msg.sender)
    {
        _mint(msg.sender, INITIAL_SUPPLY - REWARD_POOL);
        _mint(address(this), REWARD_POOL);
    }

    /**
     * @notice Allows users to stake tokens for voting rights
     * @param amount The amount of tokens to stake
     */
    function stakeTokens(uint256 amount) external nonReentrant {
        require(amount > 0, "LHT: Stake amount must be greater than zero");
        require(balanceOf(msg.sender) >= amount, "LHT: Insufficient balance");

        _transfer(msg.sender, address(this), amount);

        Stake storage userStake = stakes[msg.sender];
        if (userStake.amount > 0) {
            userStake.amount = userStake.amount.add(amount);
            userStake.lastUpdateTime = block.timestamp;
        } else {
            userStake.amount = amount;
            userStake.startTime = block.timestamp;
            userStake.lastUpdateTime = block.timestamp;
        }
        stakes[msg.sender] = userStake;

        emit TokensStaked(msg.sender, amount);
    }

    /**
     * @notice Allows users to unstake tokens after minimum staking period
     */
    function unstakeTokens() external nonReentrant {
        Stake storage userStake = stakes[msg.sender];
        require(userStake.amount > 0, "LHT: No tokens staked");
        require(
            block.timestamp >= userStake.startTime + MIN_STAKE_DURATION,
            "LHT: Minimum staking period not met"
        );

        uint256 amount = userStake.amount;
        delete stakes[msg.sender];
        _transfer(address(this), msg.sender, amount);

        emit TokensUnstaked(msg.sender, amount);
    }

    /**
     * @notice Creates a new quest with specified parameters
     */
    function createQuest(
        string calldata description,
        uint256 rewardPool,
        uint256 votingDuration,
        uint256 topParticipants
    ) external onlyOwner {
        require(bytes(description).length > 0, "LHT: Empty description");
        require(
            rewardPool > 0 && rewardPool <= balanceOf(address(this)),
            "LHT: Invalid reward pool"
        );
        require(votingDuration >= 1 days, "LHT: Voting duration too short");
        require(topParticipants > 0, "LHT: Invalid top participants count");

        uint256 questId = questIdCounter;
        questIdCounter += 1;

        quests[questId] = Quest({
            description: description,
            rewardPool: rewardPool,
            votingDuration: votingDuration,
            endTime: block.timestamp + votingDuration,
            topParticipants: topParticipants,
            isClosed: false,
            totalVotingWeight: 0
        });

        emit QuestCreated(
            questId,
            description,
            rewardPool,
            votingDuration,
            topParticipants
        );
    }

    /**
     * @notice Submit a solution for a quest
     */
    function submitSolution(
        uint256 questId,
        string calldata githubLink,
        string calldata websiteLink
    ) external {
        require(bytes(githubLink).length > 0, "LHT: Empty GitHub link");
        require(bytes(websiteLink).length > 0, "LHT: Empty website link");

        Quest storage quest = quests[questId];
        require(!quest.isClosed, "LHT: Quest is closed");
        require(
            block.timestamp <= quest.endTime,
            "LHT: Submission period ended"
        );

        for (uint256 i = 0; i < questSolutions[questId].length; i++) {
            require(
                questSolutions[questId][i].participant != msg.sender,
                "LHT: Already submitted"
            );
        }

        questSolutions[questId].push(
            Solution({
                participant: msg.sender,
                githubLink: githubLink,
                websiteLink: websiteLink,
                votes: 0,
                submissionTime: block.timestamp
            })
        );

        emit SolutionSubmitted(
            questId,
            questSolutions[questId].length.sub(1),
            msg.sender,
            githubLink,
            websiteLink
        );
    }

    /**
     * @notice Vote for a solution with stake-weighted voting power
     */
    function vote(uint256 questId, uint256 solutionId) external {
        Quest storage quest = quests[questId];
        require(!quest.isClosed, "LHT: Quest is closed");
        require(block.timestamp <= quest.endTime, "LHT: Voting period ended");
        require(
            userVotingWeight[questId][msg.sender] == 0,
            "LHT: Already voted"
        );
        require(
            solutionId < questSolutions[questId].length,
            "LHT: Invalid solution ID"
        );

        Stake storage userStake = stakes[msg.sender];
        require(userStake.amount > 0, "LHT: No staked tokens");

        uint256 votingWeight = calculateVotingWeight(userStake);
        Solution storage solution = questSolutions[questId][solutionId];

        solution.votes = solution.votes.add(votingWeight);
        quest.totalVotingWeight = quest.totalVotingWeight.add(votingWeight);
        userVotingWeight[questId][msg.sender] = votingWeight;
        questVoters[questId].push(msg.sender);

        emit VoteCast(questId, msg.sender, solutionId, votingWeight);
    }

    /**
     * @notice Distribute rewards to top participants and voters
     */
    function distributeRewards(
        uint256 questId
    ) external onlyOwner nonReentrant {
        Quest storage quest = quests[questId];
        require(
            block.timestamp > quest.endTime,
            "LHT: Voting period not ended"
        );
        require(!quest.isClosed, "LHT: Rewards already distributed");
        require(quest.totalVotingWeight > 0, "LHT: No votes cast");

        Solution[] storage solutions = questSolutions[questId];
        require(solutions.length > 0, "LHT: No solutions submitted");

        uint256 voterRewardPool = quest
            .rewardPool
            .mul(VOTER_REWARD_PERCENTAGE)
            .div(100);
        uint256 participantRewardPool = quest.rewardPool.sub(voterRewardPool);

        _quickSort(solutions, int256(0), int256(solutions.length - 1));

        uint256 rewardPerParticipant = participantRewardPool.div(
            quest.topParticipants
        );
        uint256 participantsRewarded = 0;

        for (
            uint256 i = 0;
            i < quest.topParticipants && i < solutions.length;
            i++
        ) {
            if (solutions[i].votes > 0) {
                _transfer(
                    address(this),
                    solutions[i].participant,
                    rewardPerParticipant
                );
                participantsRewarded = participantsRewarded.add(1);
            }
        }

        address[] storage voters = questVoters[questId];
        for (uint256 i = 0; i < voters.length; i++) {
            address voter = voters[i];
            uint256 voterReward = voterRewardPool
                .mul(userVotingWeight[questId][voter])
                .div(quest.totalVotingWeight);
            if (voterReward > 0) {
                _transfer(address(this), voter, voterReward);
            }
        }

        quest.isClosed = true;
        emit RewardsDistributed(
            questId,
            rewardPerParticipant.mul(participantsRewarded),
            voterRewardPool
        );
    }

    /**
     * @notice Calculate voting weight based on stake amount and duration
     */
    function calculateVotingWeight(
        Stake memory userStake
    ) internal view returns (uint256) {
        return
            userStake.amount.mul(block.timestamp.sub(userStake.startTime)).div(
                1 days
            );
    }

    /**
     * @notice Returns the current quest ID counter
     */
    function getQuestIdCounter() external view returns (uint256) {
        return questIdCounter;
    }

    /**
     * @notice Returns the details of a quest by its ID
     * @param questId The ID of the quest
     */
    function getQuest(uint256 questId) external view returns (Quest memory) {
        return quests[questId];
    }

    /**
     * @notice Returns the solutions for a quest by its ID
     * @param questId The ID of the quest
     */
    function getQuestSolutions(
        uint256 questId
    ) external view returns (Solution[] memory) {
        return questSolutions[questId];
    }

    /**
     * @notice Returns a solution for a quest by its ID
     * @param questId The ID of the quest
     * @param solutionId The ID of the solution
     */
    function getQuestSolution(
        uint256 questId,
        uint256 solutionId
    ) external view returns (Solution memory) {
        return questSolutions[questId][solutionId];
    }

    /**
     * @notice Returns the voters for a quest by its ID
     * @param questId The ID of the quest
     */
    function getQuestVoters(
        uint256 questId
    ) external view returns (address[] memory) {
        return questVoters[questId];
    }

    /**
     * @notice Returns a voter for a quest by its ID
     * @param questId The ID of the quest
     * @param voterId The ID of the voter
     */
    function getQuestVoter(
        uint256 questId,
        uint32 voterId
    ) external view returns (address) {
        return questVoters[questId][voterId];
    }

    /**
     * @notice Returns the stake details of a user
     * @param user The address of the user
     */
    function getStake(address user) external view returns (Stake memory) {
        return stakes[user];
    }

    /**
     * @notice Returns the voting weight of a user for a specific quest
     * @param questId The ID of the quest
     * @param user The address of the user
     */
    function getUserVotingWeight(
        uint256 questId,
        address user
    ) external view returns (uint256) {
        return userVotingWeight[questId][user];
    }

    /**
     * @notice QuickSort implementation for sorting solutions by votes
     */
    function _quickSort(
        Solution[] storage arr,
        int256 left,
        int256 right
    ) internal {
        if (left >= right) return;

        int256 pivot = right;
        int256 i = left - 1;

        for (int256 j = left; j < right; j++) {
            if (arr[uint256(j)].votes >= arr[uint256(pivot)].votes) {
                i++;
                Solution memory temp = arr[uint256(j)];
                arr[uint256(j)] = arr[uint256(i)];
                arr[uint256(i)] = temp;
            }
        }

        Solution memory pivotEle = arr[uint256(pivot)];
        arr[uint256(pivot)] = arr[uint256(i + 1)];
        arr[uint256(i + 1)] = pivotEle;

        _quickSort(arr, left, i);
        _quickSort(arr, i + 2, right);
    }
}
