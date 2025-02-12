import axios from "axios";
import chalk from "chalk";
import logSymbols from "log-symbols";
import { google } from "googleapis";
import { fileURLToPath } from "url";
import path from "path";
// Define __filename and __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Enhanced logging functions using chalk and log-symbols
function logStatus(message) {
    console.log(`${logSymbols.info} ${chalk.cyan(message)}`);
}
function logSuccess(message) {
    console.log(`${logSymbols.success} ${chalk.green(message)}`);
}
function logWarning(message) {
    console.log(`${logSymbols.warning} ${chalk.yellow(message)}`);
}
function logError(message) {
    console.error(`${logSymbols.error} ${chalk.red(message)}`);
}
// API URLs
const MAINNET_API_URL = "https://api.axelarscan.io/gmp/GMPStats";
const TESTNET_API_URL = "https://testnet.api.axelarscan.io/gmp/GMPStats";
// Fetch contracts count from API
async function fetchContractsCount(network, fromTime, toTime) {
    try {
        const apiUrl = network === "mainnet"
            ? MAINNET_API_URL
            : network === "testnet"
                ? TESTNET_API_URL
                : (() => {
                    throw new Error(`Unsupported network: ${network}`);
                })();
        logStatus(`Initiating API call for ${network.toUpperCase()} using URL: ${apiUrl}`);
        logStatus(`Time range: ${fromTime} to ${toTime} (Unix timestamps)`);
        // Send only fromTime and toTime as per UI sample
        const response = await axios.post(apiUrl, { fromTime, toTime });
        const messages = response.data.messages;
        if (!Array.isArray(messages)) {
            logWarning(`No messages array in API response for ${network}.`);
            return 0;
        }
        logStatus(`API returned ${messages.length} messages for ${network}.`);
        const contractsSet = new Set();
        messages.forEach((message) => {
            if (Array.isArray(message.source_chains)) {
                message.source_chains.forEach((source) => {
                    if (Array.isArray(source.destination_chains)) {
                        source.destination_chains.forEach((dest) => {
                            if (Array.isArray(dest.contracts)) {
                                dest.contracts.forEach((contract) => {
                                    if (contract.key)
                                        contractsSet.add(contract.key);
                                });
                            }
                        });
                    }
                });
            }
            if (Array.isArray(message.destination_chains)) {
                message.destination_chains.forEach((dest) => {
                    if (Array.isArray(dest.contracts)) {
                        dest.contracts.forEach((contract) => {
                            if (contract.key)
                                contractsSet.add(contract.key);
                        });
                    }
                });
            }
        });
        logStatus(`Processed API response for ${network}: Found ${contractsSet.size} unique contract(s).`);
        return contractsSet.size;
    }
    catch (error) {
        logError(`Error fetching data for ${network} (from ${fromTime} to ${toTime}): ${error}`);
        return 0;
    }
}
// Update Google Sheet using the Sheets API
async function updateGoogleSheet(rowData) {
    try {
        // Path to your service account credentials JSON file
        const keyFile = path.resolve(__dirname, "credentials.json");
        // const auth = new google.auth.GoogleAuth({
        //   keyFile,
        //   scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        // });
        // const client = await auth.getClient();
        // const sheets = google.sheets({ version: "v4", auth: client });
        const auth = new google.auth.GoogleAuth({
            keyFile,
            scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        });
        const sheets = google.sheets({ version: "v4", auth });
        // Replace with your actual spreadsheet ID
        const spreadsheetId = "1g0K4b47ws9qE5noroWc5LrbX-L1V9xyKW-ukbOmCSEE";
        // Append the row to the first sheet ("Sheet1")
        const result = await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: "Sheet1",
            valueInputOption: "USER_ENTERED",
            insertDataOption: "INSERT_ROWS",
            requestBody: {
                values: [rowData],
            },
        });
        logSuccess("Google Sheet updated successfully.");
        console.log(result.data);
    }
    catch (error) {
        logError(`Error updating Google Sheet: ${error}`);
    }
}
// Main process: fetch data and update Google Sheet
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
        const currentDate = new Date().toLocaleString();
        logStatus(`Preparing row data for date: ${currentDate}`);
        // Create row data array
        const rowData = [
            currentDate,
            mainnet28,
            mainnetQuarter,
            mainnetAllTimeCount,
            testnet28,
            testnetQuarter,
            testnetAllTimeCount,
        ];
        // Update the Google Sheet with the new row data
        await updateGoogleSheet(rowData);
        logStatus("Process complete. Exiting.");
    }
    catch (err) {
        logError(`An error occurred in the main process: ${err}`);
    }
}
main();
