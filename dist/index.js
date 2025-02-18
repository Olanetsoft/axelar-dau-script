import dotenv from "dotenv";
dotenv.config();
import axios from "axios";
import chalk from "chalk";
import logSymbols from "log-symbols";
import { google } from "googleapis";
import { fileURLToPath } from "url";
import path from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Constants
const MAINNET_API_URL = "https://api.axelarscan.io/gmp/GMPStats";
const TESTNET_API_URL = "https://testnet.api.axelarscan.io/gmp/GMPStats";
const SECONDS_IN_DAY = 86400;
const EARLIEST_TIME = 1609459200; // Jan 1, 2021 as a safe starting point
// Enhanced logging functions
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
        logStatus(`Time range: ${new Date(fromTime * 1000).toLocaleString()} to ${new Date(toTime * 1000).toLocaleString()}`);
        const response = await axios.post(apiUrl, { fromTime, toTime });
        const messages = response.data.messages;
        if (!Array.isArray(messages)) {
            logWarning(`No messages array in API response for ${network}.`);
            return 0;
        }
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
        return contractsSet.size;
    }
    catch (error) {
        logError(`Error fetching data for ${network} (from ${fromTime} to ${toTime}): ${error}`);
        return 0;
    }
}
async function updateGoogleSheet(rowData) {
    try {
        const credentialsString = process.env.GOOGLE_CREDENTIALS;
        if (!credentialsString) {
            throw new Error("GOOGLE_CREDENTIALS not found in environment variables.");
        }
        const credentials = JSON.parse(credentialsString);
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        });
        const sheets = google.sheets({ version: "v4", auth });
        const spreadsheetId = "1g0K4b47ws9qE5noroWc5LrbX-L1V9xyKW-ukbOmCSEE";
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: "Sheet1",
            valueInputOption: "USER_ENTERED",
            insertDataOption: "INSERT_ROWS",
            requestBody: { values: [rowData] },
        });
        logSuccess(`Saved data for ${rowData[0]}`);
    }
    catch (error) {
        logError(`Error updating Google Sheet: ${error}`);
        throw error;
    }
}
async function main() {
    try {
        logStatus("Starting daily data collection...");
        // Set the exact time to 00:03:04 for consistency with historical data
        const now = new Date();
        now.setHours(0, 3, 4, 0);
        const exactTimestamp = Math.floor(now.getTime() / 1000);
        // Calculate time ranges
        const from28Days = exactTimestamp - 28 * SECONDS_IN_DAY;
        // Start quarter from beginning of calendar quarter
        const quarterStart = new Date(now);
        quarterStart.setMonth(Math.floor(quarterStart.getMonth() / 3) * 3);
        quarterStart.setDate(1);
        quarterStart.setHours(0, 3, 4, 0);
        const fromQuarter = Math.floor(quarterStart.getTime() / 1000);
        logStatus("Fetching counts for MAINNET...");
        const [mainnet28, mainnetQuarter, mainnetAllTime] = await Promise.all([
            fetchContractsCount("mainnet", from28Days, exactTimestamp),
            fetchContractsCount("mainnet", fromQuarter, exactTimestamp),
            fetchContractsCount("mainnet", EARLIEST_TIME, exactTimestamp),
        ]);
        logStatus("Fetching counts for TESTNET...");
        const [testnet28, testnetQuarter, testnetAllTime] = await Promise.all([
            fetchContractsCount("testnet", from28Days, exactTimestamp),
            fetchContractsCount("testnet", fromQuarter, exactTimestamp),
            fetchContractsCount("testnet", EARLIEST_TIME, exactTimestamp),
        ]);
        const rowData = [
            now.toLocaleString(),
            mainnet28,
            mainnetQuarter,
            mainnetAllTime,
            testnet28,
            testnetQuarter,
            testnetAllTime,
        ];
        await updateGoogleSheet(rowData);
        logSuccess("Daily data collection complete");
    }
    catch (err) {
        logError(`An error occurred in the main process: ${err}`);
    }
}
main();
