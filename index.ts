import axios from "axios";
import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";
import chalk from "chalk";
import logSymbols from "log-symbols";
import { fileURLToPath } from "url";

// Define __filename and __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Enhanced logging functions using chalk and log-symbols
function logStatus(message: string) {
  console.log(`${logSymbols.info} ${chalk.cyan(message)}`);
}
function logSuccess(message: string) {
  console.log(`${logSymbols.success} ${chalk.green(message)}`);
}
function logWarning(message: string) {
  console.log(`${logSymbols.warning} ${chalk.yellow(message)}`);
}
function logError(message: string) {
  console.error(`${logSymbols.error} ${chalk.red(message)}`);
}

// API URLs
const MAINNET_API_URL = "https://api.axelarscan.io/gmp/GMPStats";
const TESTNET_API_URL = "https://testnet.api.axelarscan.io/gmp/GMPStats";

// Fetch contracts count from API
async function fetchContractsCount(
  network: string,
  fromTime: number,
  toTime: number
): Promise<number> {
  try {
    const apiUrl =
      network === "mainnet"
        ? MAINNET_API_URL
        : network === "testnet"
        ? TESTNET_API_URL
        : (() => {
            throw new Error(`Unsupported network: ${network}`);
          })();

    logStatus(
      `Initiating API call for ${network.toUpperCase()} using URL: ${apiUrl}`
    );
    logStatus(`Time range: ${fromTime} to ${toTime} (Unix timestamps)`);

    // Send only fromTime and toTime as per UI sample
    const response = await axios.post(apiUrl, { fromTime, toTime });
    const messages = response.data.messages;
    if (!Array.isArray(messages)) {
      logWarning(`No messages array in API response for ${network}.`);
      return 0;
    }
    logStatus(`API returned ${messages.length} messages for ${network}.`);

    const contractsSet = new Set<string>();
    messages.forEach((message: any) => {
      if (Array.isArray(message.source_chains)) {
        message.source_chains.forEach((source: any) => {
          if (Array.isArray(source.destination_chains)) {
            source.destination_chains.forEach((dest: any) => {
              if (Array.isArray(dest.contracts)) {
                dest.contracts.forEach((contract: any) => {
                  if (contract.key) contractsSet.add(contract.key);
                });
              }
            });
          }
        });
      }
      if (Array.isArray(message.destination_chains)) {
        message.destination_chains.forEach((dest: any) => {
          if (Array.isArray(dest.contracts)) {
            dest.contracts.forEach((contract: any) => {
              if (contract.key) contractsSet.add(contract.key);
            });
          }
        });
      }
    });

    logStatus(
      `Processed API response for ${network}: Found ${contractsSet.size} unique contract(s).`
    );
    return contractsSet.size;
  } catch (error) {
    logError(
      `Error fetching data for ${network} (from ${fromTime} to ${toTime}): ${error}`
    );
    return 0;
  }
}

// Main process: update Excel sheet
async function main() {
  try {
    logStatus("Starting main process...");

    // For "all time" records, set fromTime to 0 (Unix epoch)
    const fromAllTime = 0;
    logStatus(`All time query set from Unix epoch (fromTime: ${fromAllTime})`);

    // Current time as the end of our query period
    const now = Math.floor(Date.now() / 1000);
    const secondsInDay = 86400;
    const from28Days = now - 28 * secondsInDay;
    const fromQuarter = now - 90 * secondsInDay;

    logStatus("Calculated time periods:");
    logStatus(` - Last 28 days: ${from28Days} to ${now}`);
    logStatus(` - Last 90 days (Quarter): ${fromQuarter} to ${now}`);
    logStatus(` - All time: ${fromAllTime} to ${now}`);

    logStatus("Fetching counts for MAINNET...");
    const [mainnet28, mainnetQuarter, mainnetAllTimeCount] = await Promise.all([
      fetchContractsCount("mainnet", from28Days, now),
      fetchContractsCount("mainnet", fromQuarter, now),
      fetchContractsCount("mainnet", fromAllTime, now),
    ]);

    logStatus("Fetching counts for TESTNET...");
    const [testnet28, testnetQuarter, testnetAllTimeCount] = await Promise.all([
      fetchContractsCount("testnet", from28Days, now),
      fetchContractsCount("testnet", fromQuarter, now),
      fetchContractsCount("testnet", fromAllTime, now),
    ]);

    logStatus("Preparing Excel workbook...");
    const workbook = new ExcelJS.Workbook();
    const fileName = path.resolve(__dirname, "contracts.xlsx");
    let worksheet: ExcelJS.Worksheet;

    if (fs.existsSync(fileName)) {
      logStatus("Excel file exists. Loading workbook...");
      await workbook.xlsx.readFile(fileName);
      worksheet =
        workbook.getWorksheet("Sheet1") || workbook.addWorksheet("Sheet1");
    } else {
      logStatus("Excel file not found. Creating new workbook...");
      worksheet = workbook.addWorksheet("Sheet1");
      worksheet.addRow([
        "Date",
        "Mainnet 28 DAU",
        "Mainnet Quarter",
        "Mainnet All Time",
        "Testnet 28 DAU",
        "Testnet Quarter",
        "Testnet All Time",
      ]);
    }

    const currentDate = new Date().toLocaleString();
    logStatus(`Appending new data row for date: ${currentDate}`);
    worksheet.addRow([
      currentDate,
      mainnet28,
      mainnetQuarter,
      mainnetAllTimeCount,
      testnet28,
      testnetQuarter,
      testnetAllTimeCount,
    ]);

    await workbook.xlsx.writeFile(fileName);
    logSuccess(`Excel sheet updated successfully and saved to ${fileName}.`);
    logStatus("Process complete. Exiting.");
  } catch (err) {
    logError(`An error occurred in the main process: ${err}`);
  }
}

main();
