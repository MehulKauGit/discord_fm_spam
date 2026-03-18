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
  client.login(process.env.DISCORD_TOKEN).catch((err) => {
    console.error(`❌ Login failed (attempt ${attempt}):`, err.message);
    const delay = Math.min(attempt * 5000, 60_000); // back-off, max 60 s
    console.log(`⏳ Retrying in ${delay / 1000}s…`);
    setTimeout(() => loginWithRetry(attempt + 1), delay);
  });
}

loginWithRetry();
