const { google } = require("googleapis");
const { promisify } = require("util");
const fs = require("fs");
const ethers = require("ethers");
require("dotenv").config();

const vaultAbi = require("../abi/vault.json");
const erc20Abi = require("../abi/erc20.json");
const vaultAddress = process.env.VAULT_ADDRESS;
const aaveEthDebtTokenAddress = process.env.AAVE_ETH_DEBT_TOKEN_ADDRESS;
const aaveUsdcCollateralTokenAddress = process.env.AAVE_USDC_COLLATERAL_TOKEN_ADDRESS;

const provider = new ethers.JsonRpcProvider(process.env.PROVIDER_URL);
const signer = new ethers.Wallet(process.env.WALLET_PRIVATE_KEY, provider);

const vault = new ethers.Contract(vaultAddress, vaultAbi, provider);
const collateralToken = new ethers.Contract(aaveUsdcCollateralTokenAddress, erc20Abi, provider);
const debtToken = new ethers.Contract(aaveEthDebtTokenAddress, erc20Abi, provider);

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