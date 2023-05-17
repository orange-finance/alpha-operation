const { google } = require("googleapis");
const ethers = require("ethers");
require("dotenv").config();

//SC Setup
const provider = new ethers.JsonRpcProvider(process.env.PROVIDER_URL);
const signer = new ethers.Wallet(process.env.WALLET_PRIVATE_KEY, provider);

const vaultAbi = require("../abi/vault.json");
const computerAbi = require("../abi/alphaComputer.json");
const aTokenAbi = require("../abi/aToken.json");
const variableDebtTokenAbi = require("../abi/variableDebtToken.json");
const aavePoolAbi = require("../abi/aavePool.json");
const uniswapPoolAbi = require("../abi/uniswapPool.json");

const vaultAddress = process.env.VAULT_ADDRESS;
const computerAddress = process.env.COMPUTER_ADDRESS;
const aaveUsdcCollateralTokenAddress = process.env.AAVE_USDC_COLLATERAL_TOKEN_ADDRESS;
const aaveEthDebtTokenAddress = process.env.AAVE_ETH_DEBT_TOKEN_ADDRESS;
const aavePoolAddress = process.env.AAVE_POOL_ADDRESS;
const uniswapPoolAddress = process.env.UNISWAP_POOL_ADDRESS;

const vault = new ethers.Contract(vaultAddress, vaultAbi, provider);
const computer = new ethers.Contract(computerAddress, computerAbi, provider);
const collateralToken = new ethers.Contract(aaveUsdcCollateralTokenAddress, aTokenAbi, provider);
const debtToken = new ethers.Contract(aaveEthDebtTokenAddress, variableDebtTokenAbi, provider);
const aavePool = new ethers.Contract(aavePoolAddress, aavePoolAbi, provider);
const uniswapPool = new ethers.Contract(uniswapPoolAddress, uniswapPoolAbi, provider);

//Google Setup
const auth = new google.auth.GoogleAuth({
  credentials: {
    type: process.env.TYPE,
    project_id: process.env.PROJECT_ID,
    private_key_id: process.env.PRIVATE_KEY_ID,
    private_key: process.env.PRIVATE_KEY,
    client_email: process.env.CLIENT_EMAIL,
    client_id: process.env.CLIENT_ID,
    auth_uri: process.env.AUTH_URI,
    token_uri: process.env.TOKEN_URI,
    auth_provider_x509_cert_url: process.env.AUTH_PROVIDER_X509_CERT_URL,
    client_x509_cert_url: process.env.CLIENT_X509_CERT_URL,
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const sheetId = process.env.SHEET_ID;

//===== Contract Interaction =====//
async function executeRebalance(configs) {
  try {
    console.log("rebalance start.", configs);
    //get min new liquidity
    const newLiquidity = await vault.getRebalancedLiquidity(
      configs[2][0], //lower tick
      configs[1][0], //upper tick
      configs[3][0], //stoploss lower tick
      configs[0][0], //stoploss upper tick
      configs[4][0] //hedge ratio);
    );
    console.log("newLiquidity", newLiquidity);

    const targetLiquidity = (newLiquidity * 95n) / 100n;
    console.log("targetLiquidity", targetLiquidity);

    const data = vault.interface.encodeFunctionData("rebalance", [
      configs[2][0], //lower tick
      configs[1][0], //upper tick
      configs[3][0], //stoploss lower tick
      configs[0][0], //stoploss upper tick
      configs[4][0], //hedge ratio);
      targetLiquidity,
    ]);

    const tx = await signer.sendTransaction({
      to: vaultAddress,
      from: signer.address,
      data: data,
    });

    const receipt = await tx.wait();
    console.log(`Mined in block ${receipt.blockNumber}`);

    await logData("Rebalance");
  } catch (error) {
    console.log("Rebalance Failed:", error);
    await logData(`Rebalance Failed: ${error}`);
  }
}

async function getFeeGrowthInside(tokenNumber, currentTick, upperTick, lowerTick) {
  const feeGrowthGlobal = await eval(`uniswapPool.feeGrowthGlobal${tokenNumber}X128()`);
  const feeGrowthOutsideUpper = (await uniswapPool.ticks(upperTick))[2 + tokenNumber];
  const feeGrowthOutsideLower = (await uniswapPool.ticks(lowerTick))[2 + tokenNumber];

  const feeGrowthAbove = currentTick < upperTick ? feeGrowthOutsideUpper : feeGrowthGlobal - feeGrowthOutsideUpper;
  const feeGrowthBelow = currentTick >= lowerTick ? feeGrowthOutsideLower : feeGrowthGlobal - feeGrowthOutsideLower;

  const feeGrowthInside = feeGrowthGlobal - feeGrowthBelow - feeGrowthAbove;

  return feeGrowthInside;
}

//===== SpreadSheet Interaction =====//
async function readSheet(range) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: range,
  });
  return response.data.values;
}

async function writeSheet(range, data) {
  const request = {
    spreadsheetId: sheetId,
    range: range,
    valueInputOption: "RAW",
    resource: {
      values: data,
    },
  };
  const response = await sheets.spreadsheets.values.update(request);
  console.log(`Updated ${response.data.updatedCells} cells`);
}

async function logData(action) {
  const totalAssets = await vault["totalAssets"]();
  const totalShares = await vault["totalSupply"]();
  const stoplossUpperTick = await vault["stoplossUpperTick"]();
  const upperTick = await vault["upperTick"]();
  const lowerTick = await vault["lowerTick"]();
  const stoplossLowerTick = await vault["stoplossLowerTick"]();
  const underlyingBalances = await vault["getUnderlyingBalances"]();
  const usdcCollateral = await collateralToken["balanceOf"](vaultAddress);
  const ethDebt = await debtToken["balanceOf"](vaultAddress);

  const currentTick = (await uniswapPool.slot0())[1];

  const hash = ethers.solidityPackedKeccak256(
    ["address", "int24", "int24"],
    [vaultAddress, lowerTick.toString(), upperTick.toString()]
  );
  const position = await uniswapPool.positions(hash);
  const liquidity = position[0];
  const feeGrowthInside0Last = position[1];
  const feeGrowthInside1Last = position[2];

  const underlyingCollateralAddresss = await collateralToken.UNDERLYING_ASSET_ADDRESS(); //USDC Address
  const underlyingDebtAddress = await debtToken.UNDERLYING_ASSET_ADDRESS(); //WETH Address

  /**
    Aave
    struct ReserveData {
        ReserveConfigurationMap configuration;
        uint128 liquidityIndex;
        uint128 currentLiquidityRate;
        uint128 variableBorrowIndex;
      ...
    }
   */
  const liquidityIndex = (await aavePool.getReserveData(underlyingCollateralAddresss))[1];
  const variableBorrowIndex = (await aavePool.getReserveData(underlyingDebtAddress))[3];

  const feeGrowthInside0 = await getFeeGrowthInside(0, currentTick, upperTick, lowerTick);
  const feeGrowthInside1 = await getFeeGrowthInside(1, currentTick, upperTick, lowerTick);

  let data = [
    [Date.now()],
    [action],
    [totalAssets.toString()],
    [totalShares.toString()],
    [stoplossUpperTick.toString()],
    [upperTick.toString()],
    [currentTick.toString()],
    [lowerTick.toString()],
    [stoplossLowerTick.toString()],
    [liquidity.toString()],
    [underlyingBalances[0].toString()], //Uni ETH
    [underlyingBalances[1].toString()], //Uni USDC
    [ethDebt.toString()], //Aave ETH Debt
    [usdcCollateral.toString()], //Aave USDC Collateral
    [underlyingBalances[2].toString()], //Uni Fee ETH
    [underlyingBalances[3].toString()], //Uni Fee USDC
    [underlyingBalances[4].toString()], //Contract ETH
    [underlyingBalances[5].toString()], //Contract USDC
    [liquidityIndex.toString()], //USDC liquidityIndex
    [variableBorrowIndex.toString()], //ETH variableBorrowingIndex
    [feeGrowthInside0.toString()],
    [feeGrowthInside0Last.toString()],
    [feeGrowthInside1.toString()],
    [feeGrowthInside1Last.toString()],
  ];

  const latestRow = await readSheet("Log!C1");

  //log data
  const range = `Log!B${latestRow}:Y${latestRow}`;

  const request = {
    spreadsheetId: sheetId,
    range: range,
    valueInputOption: "RAW",
    resource: {
      majorDimension: "COLUMNS",
      values: data,
    },
  };
  const response = await sheets.spreadsheets.values.update(request);
  console.log(`Updated ${response.data.updatedCells} cells`);

  return data;
}

//========================================//
async function main() {
  const data = await logData("Log"); //log current state
  console.log(data);

  //1. Input Current Position from Vault
  const input = [data[2], data[4], data[5], data[6], data[7], data[8], data[10], data[12]];
  await writeSheet("Rebalance!F3:F10", input);

  //2. import calculated New Position
  //nothing to do from this side.

  //3. Calculate ticks, and get apply hedge ratio
  const upperTick = (await readSheet("Rebalance!P5"))[0].toString();
  const lowerTick = (await readSheet("Rebalance!P7"))[0].toString();
  const targetHedgeRatio = (await readSheet("Rebalance!P9"))[0].toString();

  console.log(upperTick);
  console.log(lowerTick);
  console.log(targetHedgeRatio);

  const applyHedgeRatio = (await computer.computeApplyHedgeRatio(lowerTick, upperTick, targetHedgeRatio)).toString();
  console.log(applyHedgeRatio);
  await writeSheet("Rebalance!P10", [[applyHedgeRatio]]);

  //4. Rebalance Judgement
  const isRebalance = await readSheet("Rebalance!G21");
  console.log(isRebalance[0]);

  if (isRebalance[0] == "TRUE") {
    console.log("Rebalance");
    //5. Rebalance when applicable
    const configs = await readSheet("Rebalance!K15:K19");
    await executeRebalance(configs);
  }
}

module.exports = { main };
