require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const express = require("express");
const app = express();

// ─── Global crash guards ───────────────────────────────────────────────────
process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
  // Don't exit — let Render's process keep running
});

// ─── Express keep-alive server ─────────────────────────────────────────────
app.get("/", (_req, res) => res.send("Bot is alive"));
app.get("/health", (_req, res) => {
  const status = client.isReady() ? "online" : "connecting";
  res.json({ status, uptime: process.uptime() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Web server running on port ${PORT}`);
});

// ─── Discord client ────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const REQUIRED_MESSAGES = 10;
const WARNING_TEXT =
  "⚠️ **spam prevention**\nPlease wait until **10 messages** have been sent before using any fmbot commands again.";

const messageCounters = new Map();

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// Handle Discord errors without crashing
client.on("error", (err) => {
  console.error("❌ Discord client error:", err.message);
});

// Log when the bot is disconnected / sharded out
client.on("shardDisconnect", (event, shardId) => {
  console.warn(`⚠️ Shard ${shardId} disconnected (code ${event.code}). discord.js will auto-reconnect.`);
});

client.on("shardReconnecting", (shardId) => {
  console.log(`🔄 Shard ${shardId} reconnecting…`);
});

client.on("shardResume", (shardId, replayedEvents) => {
  console.log(`✅ Shard ${shardId} resumed (replayed ${replayedEvents} events).`);
});

// Catch fatal gateway close codes (e.g. 4014 = Disallowed Intents)
client.on("shardError", (error, shardId) => {
  console.error(`❌ Shard ${shardId} WebSocket error:`, error.message);
  if (error.message.includes("4014")) {
    console.error("🚨 Error 4014: Disallowed Intents — enable 'Message Content Intent' in the Discord Developer Portal under Bot > Privileged Gateway Intents");
  }
});

// ─── Message monitoring (do not modify) ───────────────────────────────────
client.on("messageCreate", async (message) => {
  if (!message.guild) return;

  const channelId = message.channel.id;

  // Initialize counter if missing
  if (!messageCounters.has(channelId)) {
    messageCounters.set(channelId, REQUIRED_MESSAGES);
  }

  // Count human messages
  if (!message.author.bot) {
    messageCounters.set(channelId, messageCounters.get(channelId) + 1);
    return;
  }

  // Only fmbot
  if (message.author.id !== process.env.FMBOT_ID) return;

  const count = messageCounters.get(channelId);

  if (count < REQUIRED_MESSAGES) {
    try {
      await message.delete();
      console.log("✅ Deleted fmbot message");
    } catch (err) {
      console.error("❌ Failed to delete fmbot message:", err);
    }

    const warning = await message.channel.send(WARNING_TEXT);

    setTimeout(() => {
      warning.delete().catch(() => { });
    }, 10_000);

    return;
  }

  // Allowed → reset counter
  messageCounters.set(channelId, 0);
});

// ─── Login ─────────────────────────────────────────────────────────────────
console.log("TOKEN EXISTS:", !!process.env.DISCORD_TOKEN);
console.log("FMBOT_ID:", process.env.FMBOT_ID);

function loginWithRetry(attempt = 1) {
  console.log(`🔄 Attempting Discord login (attempt ${attempt})…`);

  // Timeout diagnostic: if login hangs >30s, log it so Render logs reveal the hang
  const hangTimer = setTimeout(() => {
    console.warn(`⚠️ Login attempt ${attempt} has not resolved after 30s — possible network issue or invalid token`);
  }, 30_000);

  client.login(process.env.DISCORD_TOKEN)
    .then(() => {
      clearTimeout(hangTimer);
      console.log(`✅ Login promise resolved (attempt ${attempt}) — waiting for ready event…`);
    })
    .catch((err) => {
      clearTimeout(hangTimer);
      console.error(`❌ Login failed (attempt ${attempt}): [${err.code ?? "unknown"}] ${err.message}`);
      const delay = Math.min(attempt * 5000, 60_000);
      console.log(`⏳ Retrying in ${delay / 1000}s…`);
      setTimeout(() => loginWithRetry(attempt + 1), delay);
    });
}

loginWithRetry();
