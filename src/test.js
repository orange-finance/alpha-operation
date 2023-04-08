const { google } = require("googleapis");
const ethers = require("ethers");
require("dotenv").config();

async function main() {
  const addr = "0x8163546af0a7716604150aFc59A8DAAa5C2E7EEB";
  const hash = ethers.solidityPackedKeccak256(["address", "int24", "int24"], [addr, -201150, -200740]);
  console.log(hash);
}

main();
