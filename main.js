const { google } = require("googleapis");
const { promisify } = require("util");
const fs = require("fs");
const ethers = require("ethers");
require("dotenv").config();

const vaultAbi = require("./abi/vault.json");
const erc20Abi = require("./abi/erc20.json");
const vaultAddress = "0x8163546af0a7716604150aFc59A8DAAa5C2E7EEB";
const aaveEthDebtTokenAddress = "0x0c84331e39d6658Cd6e6b9ba04736cC4c4734351";
const aaveUsdcCollateralTokenAddress = "0x625E7708f30cA75bfd92586e17077590C60eb4cD";

const provider = new ethers.JsonRpcProvider(process.env.PROVIDER_URL);
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const vault = new ethers.Contract(vaultAddress, vaultAbi, provider);
const collateralToken = new ethers.Contract(aaveUsdcCollateralTokenAddress, erc20Abi, provider);
const debtToken = new ethers.Contract(aaveEthDebtTokenAddress, erc20Abi, provider);

const auth = new google.auth.GoogleAuth({
  keyFile: "./credentials.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const sheetId = "1C0ixjXgLbfnKUMXZs0hHZ5-6HqPLU5IC22VUS43MRas";

//===== Vault Interaction =====//
async function readVault() {
  const totalAssets = await vault["totalAssets"]();
  const stoplossUpperTick = await vault["stoplossUpperTick"]();
  const upperTick = await vault["upperTick"]();
  const lowerTick = await vault["lowerTick"]();
  const stoplossLowerTick = await vault["stoplossLowerTick"]();
  const underlyingBalances = await vault["getUnderlyingBalances"]();
  const ethPosition = underlyingBalances[0];
  const usdcCollateral = await collateralToken["balanceOf"](vaultAddress);
  const ethDebt = await debtToken["balanceOf"](vaultAddress);

  const log = [
    [totalAssets.toString()],
    [stoplossUpperTick.toString()],
    [upperTick.toString()],
    [lowerTick.toString()],
    [stoplossLowerTick.toString()],
    [underlyingBalances[0].toString()], //Uni ETH
    [underlyingBalances[1].toString()], //Uni USDC
    [ethDebt.toString()], //Aave ETH Debt
    [usdcCollateral.toString()], //Aave USDC Collateral
    [underlyingBalances[2].toString()], //Uni Fee ETH
    [underlyingBalances[3].toString()], //Uni Fee USDC
    [underlyingBalances[4].toString()], //Contract ETH
    [underlyingBalances[5].toString()], //Contract USDC
  ];

  return log;
}

async function executeRebalance(configs) {
  try {
    //get min new liquidity
    const newLiquidity = await vault.getRebalancedLiquidity(
      configs[2][0], //lower tick
      configs[1][0], //upper tick
      configs[3][0], //stoploss lower tick
      configs[0][0], //stoploss upper tick
      configs[4][0] //hedge ratio);
    );

    const targetLiquidity = (newLiquidity * 99n) / 100n;

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
    console.error("Rebalance Failed:", error);
    await logData("Rebalance Failed");
  }
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
  let data = await readVault();

  const latestRow = await readSheet("Log!C1");
  data.unshift([Date.now()], [action]);

  //log data
  const range = `Log!B${latestRow}:P${latestRow}`;

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

  //update Spreadsheet
  const input = [data[2], data[3], data[4], data[5], data[6], data[7], data[9]];
  await writeSheet("Rebalance!H2:H8", input);

  //rebalance when applicable
  const isRebalance = await readSheet("Rebalance!A5");
  console.log(isRebalance[0]);

  if (isRebalance[0] == "TRUE") {
    const configs = await readSheet("Rebalance!E2:E6");
    await executeRebalance(configs);
  }
}

main();
