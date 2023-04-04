
# Automated UniswapV3/Aave Rebalance with Google Sheets
This is a JavaScript program that interacts with the Orange Finance's USDC-ETH Vault and a Google Spreadsheet to manage automated rebalancing of UniswapV3 Position and Aave Colalteral/Debt. It reads data from the Vault smart contract and writes data to a designated spreadsheet, where calculates the rebalance configs and rebalance validity.

## Note
Only Orange Finance Core Team is allowed to operate this script. (other party doesn't have permission to modify spreadsheet nor call rebalance function)

The program will log the current state of the Vault, update the designated Spreadsheet with relevant data, and check if a rebalance should be executed based on the "isRebalance" flag in the "Rebalance" tab of the sheet.

If a rebalance is needed, the program will call the executeRebalance function with the specified configurations from the "Rebalance" tab. This function will interact with the Orange Finance Vault smart contract to initiate the rebalance.

Check the comments in the code for more information on how it works.
