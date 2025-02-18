import dotenv from "dotenv";
dotenv.config();
import axios from "axios";
import { google } from "googleapis";
import chalk from "chalk";
import logSymbols from "log-symbols";
const MAINNET_API_URL = "https://api.axelarscan.io/gmp/GMPStats";
const TESTNET_API_URL = "https://testnet.api.axelarscan.io/gmp/GMPStats";
const SECONDS_IN_DAY = 86400;
const EARLIEST_TIME = 1609459200; // Jan 1, 2021 as a safe starting point
function logStatus(message) {
    console.log(`${logSymbols.info} ${chalk.cyan(message)}`);
}
function logSuccess(message) {
    console.log(`${logSymbols.success} ${chalk.green(message)}`);
}
function logError(message) {
    console.error(`${logSymbols.error} ${chalk.red(message)}`);
}
async function fetchContractsCount(network, fromTime, toTime) {
    try {
        const apiUrl = network === "mainnet" ? MAINNET_API_URL : TESTNET_API_URL;
        logStatus(`API call to ${network} from ${new Date(fromTime * 1000).toLocaleString()} to ${new Date(toTime * 1000).toLocaleString()}`);
        const response = await axios.post(apiUrl, { fromTime, toTime });
        const uniqueContracts = new Set();
        if (Array.isArray(response.data.messages)) {
            response.data.messages.forEach((message) => {
                if (Array.isArray(message.source_chains)) {
                    message.source_chains.forEach((source) => {
                        if (Array.isArray(source.destination_chains)) {
                            source.destination_chains.forEach((dest) => {
                                if (Array.isArray(dest.contracts)) {
                                    dest.contracts.forEach((contract) => {
                                        if (contract.key)
                                            uniqueContracts.add(contract.key);
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
                                    uniqueContracts.add(contract.key);
                            });
                        }
                    });
                }
            });
        }
        return uniqueContracts.size;
    }
    catch (error) {
        logError(`Error fetching data: ${error}`);
        return 0;
    }
}
async function updateGoogleSheet(rowData) {
    try {
        const credentialsString = process.env.GOOGLE_CREDENTIALS;
        if (!credentialsString) {
            throw new Error("GOOGLE_CREDENTIALS not found");
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
        logError(`Error updating sheet: ${error}`);
        throw error;
    }
}
async function backfillHistoricalData() {
    try {
        logStatus("Starting historical data backfill...");
        // Start date: December 6, 2024 00:03:04
        const startDate = new Date("2025-02-10T00:03:04Z");
        const startTimestamp = Math.floor(startDate.getTime() / 1000);
        logStatus(`Start: ${startDate.toLocaleString()}`);
        // End date: today (minus 1 day for safety)
        const endTimestamp = Math.floor(Date.now() / 1000) - SECONDS_IN_DAY;
        const endDate = new Date(endTimestamp * 1000);
        logStatus(`End: ${endDate.toLocaleString()}`);
        let currTimestamp = startTimestamp;
        while (currTimestamp <= endTimestamp) {
            try {
                const date = new Date(currTimestamp * 1000);
                date.setHours(0, 3, 4, 0); // Ensure consistent time
                const exactTimestamp = Math.floor(date.getTime() / 1000);
                logStatus(`Processing ${date.toLocaleString()}`);
                // Calculate ranges
                const from28Days = exactTimestamp - 28 * SECONDS_IN_DAY;
                // Start quarter from beginning of calendar quarter
                const quarterStart = new Date(date);
                quarterStart.setMonth(Math.floor(quarterStart.getMonth() / 3) * 3);
                quarterStart.setDate(1);
                quarterStart.setHours(0, 3, 4, 0);
                const fromQuarter = Math.floor(quarterStart.getTime() / 1000);
                // For each date, we get all-time data from the earliest possible time up to that specific date
                const [mainnet28, mainnetQuarter, mainnetAllTime] = await Promise.all([
                    fetchContractsCount("mainnet", from28Days, exactTimestamp),
                    fetchContractsCount("mainnet", fromQuarter, exactTimestamp),
                    fetchContractsCount("mainnet", EARLIEST_TIME, exactTimestamp),
                ]);
                const [testnet28, testnetQuarter, testnetAllTime] = await Promise.all([
                    fetchContractsCount("testnet", from28Days, exactTimestamp),
                    fetchContractsCount("testnet", fromQuarter, exactTimestamp),
                    fetchContractsCount("testnet", EARLIEST_TIME, exactTimestamp),
                ]);
                const rowData = [
                    date.toLocaleString(),
                    mainnet28,
                    mainnetQuarter,
                    mainnetAllTime,
                    testnet28,
                    testnetQuarter,
                    testnetAllTime,
                ];
                await updateGoogleSheet(rowData);
                // Add a delay between API calls to avoid rate limiting
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }
            catch (error) {
                logError(`Error processing ${new Date(currTimestamp * 1000).toLocaleString()}: ${error}`);
            }
            currTimestamp += SECONDS_IN_DAY;
        }
        logStatus("Historical data backfill complete");
    }
    catch (err) {
        logError(`Backfill process error: ${err}`);
    }
}
// Run backfill
backfillHistoricalData();
