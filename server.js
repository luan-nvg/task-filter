import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";
import OpenAI from "openai";

dotenv.config();

const jiraDomain = process.env.JIRA_DOMAIN;
const jiraEmail = process.env.JIRA_EMAIL;
const jiraApiToken = process.env.JIRA_API_TOKEN;
const keyGpt = process.env.CHAT_GPT_API_KEY;

const openai = keyGpt
  ? new OpenAI({
      apiKey: keyGpt, // defaults to process.env["OPENAI_API_KEY"]
    })
  : null;

// Function to sleep for a given number of milliseconds
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Function to calculate the start and end dates based on the provided month and year
function getDynamicDateRange(month, year) {
  const startDate = new Date(year, month - 1, 1); // First day of the month
  const endDate = new Date(year, month, 0); // Last day of the month (0 gets the last day of the previous month)
  const start = startDate.toISOString().split("T")[0]; // Format as YYYY-MM-DD
  const end = endDate.toISOString().split("T")[0]; // Format as YYYY-MM-DD
  return { start, end };
}

// Function to construct the JQL query with dynamic date range and desired statuses
function constructJqlQuery(startDate, endDate) {
  return `status CHANGED TO "Closed" BY currentUser() DURING ("${startDate}", "${endDate}") 
          OR status CHANGED TO "DONE" BY currentUser() DURING ("${startDate}", "${endDate}") 
          OR status CHANGED TO "Code Review" BY currentUser() DURING ("${startDate}", "${endDate}") 
          AND status NOT IN ("Pending")`;
}

// Function to execute the JQL query
async function executeJqlQuery(jqlQuery) {
  try {
    const response = await axios.get(
      `https://${jiraDomain}/rest/api/2/search?jql=${encodeURIComponent(
        jqlQuery
      )}`,
      {
        auth: {
          username: jiraEmail,
          password: jiraApiToken,
        },
      }
    );

    if (response.status === 200) {
      const data = response.data;

      // Create an array to store the table data
      const tableData = [];

      // Loop through the issues and make API requests with a delay
      for (const issue of data.issues) {
        const description = issue.fields.description || "";
        const completion = keyGpt
          ? await openai.chat.completions.create({
              messages: [{ role: "user", content: description }],
              model: "gpt-3.5-turbo",
            })
          : description;

          const summary = issue.fields.summary
          .replace(/\[WEB-API\]/g, "")
          .replace(/\[WEB\]\s*/g, "");

        const rowData = {
          ID: issue.key,
          Summary: summary,
          Description: completion || "",
        };

        tableData.push(rowData);

        // Add a delay between requests to avoid rate limiting
        await sleep(1000); // Sleep for 1 second (adjust as needed)
      }

      // Create a text file with the results
      createTextFile(tableData);

      console.log("Text file created successfully: jira_results.txt");
    } else {
      throw new Error("Error executing JQL query");
    }
  } catch (error) {
    throw error;
  }
}

function generateText(tableData) {
  let text = "";

  // Title "Macro Tasks"
  text += "Macro Tasks\n\n";

  // Generate text with data including the task ID under the "Macro Tasks" title
  tableData.forEach((row) => {
    text += `${row.ID} - ${row.Summary}\n`;
  });

  // Title "Details"
  text += "\nDetails\n\n";

  // Generate text with data including ID, Summary, and Description under the "Details" title
  tableData.forEach((row) => {
    text += `${row.ID} - ${row.Summary}\n`;
    // text += `Description: ${row.Description}\n`;
  });

  return text;
}

function createTextFile(tableData) {
  const outputFilePath = "jira_results.txt"; // Path to the text output file

  const text = generateText(tableData);

  fs.writeFile(outputFilePath, text, (err) => {
    if (err) {
      console.error("Error writing file:", err);
    } else {
      console.log("Text file generated successfully:", outputFilePath);
    }
  });
}

// Main function
async function main() {
  // Read month and year from command line arguments
  const [month, year] = process.argv.slice(2).map(Number);

  if (!month || !year) {
    console.error("Please provide a valid month and year as arguments.");
    console.error("Usage: npm start <month> <year> (e.g., npm start 8 2024)");
    process.exit(1);
  }

  // Get the date range dynamically
  const { start, end } = getDynamicDateRange(month, year);

  // Construct the JQL query with the dynamic dates and desired statuses
  const jqlQuery = constructJqlQuery(start, end);

  try {
    await executeJqlQuery(jqlQuery);
  } catch (error) {
    console.error("An error occurred:", error.message);
  }
}

main();