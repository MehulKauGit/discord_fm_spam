require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send("Bot is alive");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Web server running on port ${PORT}`);
});


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

client.on("messageCreate", async (message) => {
  if (!message.guild) return;

  const channelId = message.channel.id;

  // Initialize counter if missing
  if (!messageCounters.has(channelId)) {
    messageCounters.set(channelId, REQUIRED_MESSAGES);
  }

  // Debug 

  // Count human messages
  if (!message.author.bot) {
    messageCounters.set(channelId, messageCounters.get(channelId) + 1);
    return;
  }

  // Only fmbot
  if (message.author.id !== process.env.FMBOT_ID) return;

  // --- REMOVE embed check ---
  // Act on fmbot message regardless of embeds/components/content

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
      warning.delete().catch(() => {});
    }, 10_000);

    return;
  }

  // Allowed → reset counter
  messageCounters.set(channelId, 0);
});

client.login(process.env.DISCORD_TOKEN);
