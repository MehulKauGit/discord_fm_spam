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
});

// ─── Express keep-alive server ─────────────────────────────────────────────
app.get("/", (_req, res) => res.send("Bot is alive"));
app.get("/health", (_req, res) => {
  res.json({ status: "online", uptime: process.uptime() });
});

const PORT = process.env.PORT || 3000;

// ─── Discord setup ─────────────────────────────────────────────────────────
const REQUIRED_MESSAGES = 10;
const WARNING_TEXT =
  "⚠️ **spam prevention**\nPlease wait until **10 messages** have been sent before using any fmbot commands again.";

const messageCounters = new Map();

// Build a fresh client and register all event handlers
function createClient() {
  const c = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  c.once("ready", () => {
    console.log(`✅ Logged in as ${c.user.tag}`);
  });

  c.on("error", (err) => {
    console.error("❌ Discord client error:", err.message);
  });

  c.on("shardDisconnect", (event, shardId) => {
    console.warn(`⚠️ Shard ${shardId} disconnected (code ${event.code}). Will auto-reconnect.`);
  });

  c.on("shardReconnecting", (shardId) => {
    console.log(`🔄 Shard ${shardId} reconnecting…`);
  });

  c.on("shardResume", (shardId, replayedEvents) => {
    console.log(`✅ Shard ${shardId} resumed (replayed ${replayedEvents} events).`);
  });

  c.on("shardError", (error) => {
    console.error("❌ Shard WebSocket error:", error.message);
    if (error.message.includes("4014")) {
      console.error("🚨 Error 4014: enable Message Content Intent in Discord Developer Portal.");
    }
  });

  // ─── Message monitoring (do not modify) ─────────────────────────────────
  c.on("messageCreate", async (message) => {
    if (!message.guild) return;

    const channelId = message.channel.id;

    if (!messageCounters.has(channelId)) {
      messageCounters.set(channelId, REQUIRED_MESSAGES);
    }

    if (!message.author.bot) {
      messageCounters.set(channelId, messageCounters.get(channelId) + 1);
      return;
    }

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

    messageCounters.set(channelId, 0);
  });

  return c;
}

// ─── Login with retry (destroys & recreates client on hang/failure) ────────
let client = null;

function loginWithRetry(attempt = 1) {
  // Destroy stale client if retrying
  if (client) {
    try { client.destroy(); } catch (_) { }
  }
  client = createClient();

  console.log(`🔄 Attempting Discord login (attempt ${attempt})…`);

  // If login hangs >45s, force-retry with a fresh client
  const hangTimer = setTimeout(() => {
    console.warn(`⚠️ Login attempt ${attempt} hung for 45s — recreating client and retrying…`);
    const delay = Math.min(attempt * 5000, 60_000);
    setTimeout(() => loginWithRetry(attempt + 1), delay);
  }, 45_000);

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

// ─── Start web server first, then attempt Discord login ────────────────────
console.log("TOKEN EXISTS:", !!process.env.DISCORD_TOKEN);
console.log("FMBOT_ID:", process.env.FMBOT_ID);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Web server running on port ${PORT}`);
  // Delay Discord login until after the port is confirmed open — fixes
  // Render cold-start WebSocket hang (outbound connections work reliably
  // only once the service is considered healthy by the platform).
  setTimeout(loginWithRetry, 3000);
});
