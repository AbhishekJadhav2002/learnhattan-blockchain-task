import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const LearningToken = buildModule("LearningToken", (m) => {
  const learningToken = m.contract("LearningToken", []);

  return { learningToken };
});

export default LearningToken;
