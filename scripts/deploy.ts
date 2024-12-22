import fs from "fs";
import hre from "hardhat";
import { default as _config } from "../config/data.json";
import LearningTokenModule from "../ignition/modules/LearningToken";
import { Config, Networks } from "../types";

async function main() {
    const config: Config = _config;
    const network = hre.network.name as Networks;

    const { learningToken } = await hre.ignition.deploy(LearningTokenModule);
    config.LearningToken[network] = await learningToken.getAddress();
    console.log(`✅ LearningToken deployed to: ${await learningToken.getAddress()}`);

    fs.writeFileSync("config/data.json", JSON.stringify(config, null, 2));
    console.log("✅ Config file updated");
}

main().then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });