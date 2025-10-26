#!/usr/bin/env node

const https = require("node:https");
const path = require("node:path");

// Load QA credentials to send as PeerQA
// Check if --json is in arguments to suppress dotenv output
const jsonMode = process.argv.includes("--json");
if (!jsonMode) {
  console.log("🔧 Loading test configuration...");
}

// Temporarily redirect console.log for dotenv if in JSON mode
const originalLog = console.log;
if (jsonMode) {
  console.log = () => {
    // Suppressed for JSON mode
  };
}
require("dotenv").config({ path: path.join(__dirname, ".env") });
if (jsonMode) {
  console.log = originalLog;
}
const QA_BOT_TOKEN = process.env.QA_SLACK_BOT_TOKEN;
const TARGET_BOT_USERNAME = process.env.QA_TARGET_BOT_USERNAME;
const QA_CHANNEL = process.env.QA_SLACK_CHANNEL || "C0952LTF7DG";

// Validate required environment variables
if (!TARGET_BOT_USERNAME) {
  if (!jsonMode) {
    console.error("❌ QA_TARGET_BOT_USERNAME environment variable is required");
    console.error("Please set QA_TARGET_BOT_USERNAME in your .env file");
  }
  process.exit(1);
}

if (!QA_BOT_TOKEN) {
  if (!jsonMode) {
    console.error("❌ QA_SLACK_BOT_TOKEN environment variable is required");
    console.error("Please set QA_SLACK_BOT_TOKEN in your .env file");
  }
  process.exit(1);
}

async function makeSlackRequest(method, body) {
  return new Promise((resolve, reject) => {
    const needsUrlEncoding = [
      "conversations.info",
      "conversations.history",
      "conversations.replies",
    ].includes(method);
    const postData = needsUrlEncoding
      ? new URLSearchParams(body).toString()
      : JSON.stringify(body);

    const options = {
      hostname: "slack.com",
      port: 443,
      path: `/api/${method}`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${QA_BOT_TOKEN}`,
        "Content-Type": needsUrlEncoding
          ? "application/x-www-form-urlencoded"
          : "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const result = JSON.parse(data);
          if (result.ok) {
            resolve(result);
          } else {
            reject(new Error(`Slack API error: ${result.error}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

async function waitForBotResponse(
  channel,
  messageTs,
  timeout = 45000,
  jsonOutput = false
) {
  if (!jsonOutput) console.log("⏳ Waiting for bot response...");
  const startTime = Date.now();
  let foundResponse = null;

  while (Date.now() - startTime < timeout) {
    try {
      // Check for replies in the thread first (most common case)
      const threadReplies = await makeSlackRequest("conversations.replies", {
        channel: channel,
        ts: messageTs,
        limit: 10,
      });

      if (threadReplies.messages && threadReplies.messages.length > 1) {
        const botMessages = threadReplies.messages
          .slice(1)
          .filter((msg) => msg.bot_id);
        if (botMessages.length > 0) {
          foundResponse = botMessages[0];
          if (!jsonOutput)
            console.log(
              `📱 Found bot response in thread at ${foundResponse.ts}`
            );
          break;
        }
      }

      // Also check main channel as fallback
      const history = await makeSlackRequest("conversations.history", {
        channel: channel,
        oldest: (parseFloat(messageTs) - 5).toString(),
        limit: 20,
      });

      if (history.messages) {
        const recentBotMessages = history.messages.filter(
          (msg) => msg.bot_id && parseFloat(msg.ts) > parseFloat(messageTs)
        );
        if (recentBotMessages.length > 0) {
          foundResponse = recentBotMessages[0];
          if (!jsonOutput)
            console.log(
              `📱 Found bot response in channel at ${foundResponse.ts}`
            );
          break;
        }
      }
    } catch (error) {
      // Continue waiting on API errors
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return foundResponse;
}

async function uploadFile(filePath, channels, threadTs = null) {
  const fs = require("node:fs");
  const FormData = require("form-data");

  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("channels", channels);
    form.append("file", fs.createReadStream(filePath));
    if (threadTs) {
      form.append("thread_ts", threadTs);
    }

    const options = {
      hostname: "slack.com",
      port: 443,
      path: "/api/files.upload",
      method: "POST",
      headers: {
        Authorization: `Bearer ${QA_BOT_TOKEN}`,
        ...form.getHeaders(),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const result = JSON.parse(data);
          if (result.ok) {
            resolve(result);
          } else {
            reject(new Error(`Slack API error: ${result.error}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", reject);
    form.pipe(req);
  });
}

async function runTest(testMessage, timeout = 45000, options = {}) {
  const {
    jsonOutput = false,
    threadTs = null,
    noWait = false,
    filePath = null,
  } = options;
  const quiet = jsonOutput;

  if (!quiet) {
    console.log("🧪 Peerbot Test");
    console.log("📤 Sending as: PeerQA");
    console.log(`🎯 Target: <@${TARGET_BOT_USERNAME}>`);
    console.log("");
  }

  const targetChannel = QA_CHANNEL;
  let messageTs = threadTs;

  try {
    const prompt = testMessage;
    const message = `<@${TARGET_BOT_USERNAME}> ${prompt}`;

    if (!quiet) {
      console.log("📨 Sending test message...");
      if (filePath) {
        console.log(`📎 With file: ${filePath}`);
      }
    }

    let msg;

    if (filePath) {
      // Upload file with message
      const uploadResult = await uploadFile(filePath, targetChannel, threadTs);

      // Send message in the same thread as the file
      const requestBody = {
        channel: targetChannel,
        text: message,
        thread_ts:
          threadTs || uploadResult.file.shares.public[targetChannel][0].ts,
      };

      msg = await makeSlackRequest("chat.postMessage", requestBody);
    } else {
      // Regular message without file
      const requestBody = {
        channel: targetChannel,
        text: message,
      };

      if (threadTs) {
        requestBody.thread_ts = threadTs;
      }

      msg = await makeSlackRequest("chat.postMessage", requestBody);
    }

    messageTs = msg.ts;

    if (!quiet) {
      console.log(`✅ Sent: "${message}"`);
      console.log(`   Timestamp: ${msg.ts}`);
      console.log("");
    }

    if (noWait) {
      if (jsonOutput) {
        console.log(
          JSON.stringify({
            success: true,
            thread_ts: messageTs,
            message_ts: msg.ts,
            channel: targetChannel,
          })
        );
      }
      process.exit(0);
    }

    // Wait a moment for processing to start
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Check for bot response
    const response = await waitForBotResponse(
      targetChannel,
      messageTs,
      timeout,
      jsonOutput
    );

    if (!response) {
      if (!jsonOutput) {
        console.log(`❌ No bot response within ${timeout / 1000} seconds`);
        console.log(
          "\n🔗 Manual check: https://peerbotcommunity.slack.com/archives/" +
            targetChannel
        );
      }
      process.exit(1);
    }

    if (!jsonOutput) {
      console.log("✅ Bot responded!");
      console.log(`   Response: "${response.text?.substring(0, 200)}..."`);
      console.log("\n🎉 Test PASSED!");
    }

    if (jsonOutput) {
      console.log(
        JSON.stringify(
          {
            success: true,
            channel: targetChannel,
            thread_ts: messageTs,
            response: {
              text: response.text,
              timestamp: response.ts,
              bot_id: response.bot_id,
            },
            url: `https://peerbotcommunity.slack.com/archives/${targetChannel}`,
          },
          null,
          2
        )
      );
    } else {
      console.log(
        `\n🔗 Channel: https://peerbotcommunity.slack.com/archives/${targetChannel}`
      );
    }

    process.exit(0);
  } catch (error) {
    if (jsonOutput) {
      console.log(
        JSON.stringify({ success: false, error: error.message }, null, 2)
      );
    } else {
      console.error(`❌ Test failed: ${error.message}`);
    }
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
let message = null;
let timeout = 45000;
let jsonOutput = false;
let threadTs = null;
let noWait = false;
let filePath = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--timeout") {
    if (!args[i + 1]) {
      console.error(`❌ Error: --timeout requires a value`);
      process.exit(1);
    }
    timeout = parseInt(args[i + 1], 10) * 1000;
    i++; // Skip next arg
  } else if (args[i] === "--json") {
    jsonOutput = true;
  } else if (args[i] === "--no-wait") {
    noWait = true;
  } else if (args[i] === "--file") {
    if (!args[i + 1]) {
      console.error(`❌ Error: --file requires a file path`);
      process.exit(1);
    }
    filePath = args[i + 1];
    i++; // Skip next arg
  } else if (args[i] === "--thread-ts") {
    if (!args[i + 1]) {
      console.error(`❌ Error: --thread-ts requires a value`);
      process.exit(1);
    }
    threadTs = args[i + 1];
    i++; // Skip next arg
  } else if (args[i] === "--help" || args[i] === "-h") {
    console.log("Usage: slack-qa-bot.js [options] [message]");
    console.log("");
    console.log("Options:");
    console.log(
      "  --timeout <seconds>    Set timeout for bot response (default: 45)"
    );
    console.log("  --json                 Output JSON format");
    console.log("  --thread-ts <ts>       Post to existing thread");
    console.log("  --no-wait              Send message and exit immediately");
    console.log("  --help, -h             Show this help message");
    console.log("");
    console.log("Examples:");
    console.log('  ./slack-qa-bot.js "Hello bot"');
    console.log('  ./slack-qa-bot.js --json "Create a function"');
    process.exit(0);
  } else if (args[i].startsWith("--") || args[i].startsWith("-")) {
    // Unrecognized option
    console.error(`❌ Error: Unrecognized option: ${args[i]}`);
    console.error("Use --help for available options");
    process.exit(1);
  } else {
    // This should be the message
    if (message !== null) {
      console.error(
        `❌ Error: Multiple messages not supported. Already have: "${message}", got: "${args[i]}"`
      );
      process.exit(1);
    }
    message = args[i];
  }
}

if (message) {
  runTest(message, timeout, { jsonOutput, threadTs, noWait, filePath });
} else {
  runTest("Hello bot - simple test", timeout, { jsonOutput });
}
