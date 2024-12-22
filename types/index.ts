export type Tokens = "LearningToken";

export type Networks = "localhost" | "sepolia" | "mainnet";

export type Config = {
    [key in Tokens]: {
        [key in Networks]: string;
    }
};