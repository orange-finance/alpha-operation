const { google } = require("googleapis");
const ethers = require("ethers");
require("dotenv").config();

//SC Setup
const provider = new ethers.JsonRpcProvider(process.env.PROVIDER_URL);
const signer = new ethers.Wallet(process.env.WALLET_PRIVATE_KEY, provider);

const vaultAbi = require("../abi/vault.json");
const aTokenAbi = require("../abi/aToken.json");
const variableDebtTokenAbi = require("../abi/variableDebtToken.json");
const aavePoolAbi = require("../abi/aavePool.json");
const uniswapPoolAbi = require("../abi/uniswapPool.json");

const vaultAddress = process.env.VAULT_ADDRESS;
const aaveUsdcCollateralTokenAddress = process.env.AAVE_USDC_COLLATERAL_TOKEN_ADDRESS;
const aaveEthDebtTokenAddress = process.env.AAVE_ETH_DEBT_TOKEN_ADDRESS;
const aavePoolAddress = process.env.AAVE_POOL_ADDRESS;
const uniswapPoolAddress = process.env.UNISWAP_POOL_ADDRESS;

const vault = new ethers.Contract(vaultAddress, vaultAbi, provider);
const collateralToken = new ethers.Contract(aaveUsdcCollateralTokenAddress, aTokenAbi, provider);
const debtToken = new ethers.Contract(aaveEthDebtTokenAddress, variableDebtTokenAbi, provider);
const aavePool = new ethers.Contract(aavePoolAddress, aavePoolAbi, provider);
const uniswapPool = new ethers.Contract(uniswapPoolAddress, uniswapPoolAbi, provider);

async function hash() {
  const addr = "0x8163546af0a7716604150aFc59A8DAAa5C2E7EEB";
  const hash = ethers.solidityPackedKeccak256(["address", "int24", "int24"], [addr, -201150, -200740]);
  console.log(hash);
}

hash();
