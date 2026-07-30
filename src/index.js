require("dotenv").config();
const { Client, GatewayIntentBits, Partials } = require("discord.js");
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
    GatewayIntentBits.GuildMessageReactions, // needed to see reactions added
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.User,
  ],
});

const REQUIRED_MESSAGES = 10;
const WARNING_TEXT =
  "⚠️ **spam prevention**\nPlease wait until **10 messages** have been sent before using any fmbot commands again.";

const FMBOT_ID = process.env.FMBOT_ID;
const BLEED_ID = process.env.BLEED_ID; // <-- new env var, add this to your .env

// Layer 2: FM-identifying reaction per bot
const FM_EMOJIS = {
  [FMBOT_ID]: { type: "id", values: ["488201050353041428", "789378509939408936"] },
  [BLEED_ID]: { type: "name", values: ["👍", "👎"] },
};

// Shared counter — fmbot and bleed draw from the same pool
const messageCounters = new Map();

// Prevents double-handling the same message (bot usually adds BOTH up and down reactions)
const handledMessages = new Set();

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (!message.guild) return;

  const channelId = message.channel.id;
  if (!messageCounters.has(channelId)) {
    messageCounters.set(channelId, REQUIRED_MESSAGES);
  }

  // Only human messages advance the counter here.
  if (!message.author.bot) {
    messageCounters.set(channelId, messageCounters.get(channelId) + 1);
  }

  // NOTE: fmbot/bleed messages are intentionally NOT acted on here.
  // We don't yet know if it's an "fm" message vs. some other command output —
  // that's only confirmed once the bot's own up/down reaction lands.
});

client.on("messageReactionAdd", async (reaction, user) => {
  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
  } catch (err) {
    console.error("❌ Failed to fetch partial reaction/message:", err);
    return;
  }

  const message = reaction.message;
  if (!message.guild) return;

  const authorId = message.author?.id;

  // Layer 1: is this even a message from one of the two monitored bots?
  const isFmBot = authorId === FMBOT_ID;
  const isBleedBot = authorId === BLEED_ID;
  if (!isFmBot && !isBleedBot) return;

  // Only trust the reaction if the bot added it to its OWN message
  // (stops randoms from triggering this by reacting 👍/👎 on unrelated messages)
  if (!(user.bot && user.id === authorId)) return;

  // Layer 2: does the emoji match that bot's fm up/down-vote identifier?
  const emojiConfig = FM_EMOJIS[authorId];
  const isFmReaction =
    emojiConfig.type === "id"
      ? reaction.emoji.id === emojiConfig.values[0] || reaction.emoji.id === emojiConfig.values[1]
      : reaction.emoji.name === emojiConfig.values[0] || reaction.emoji.name === emojiConfig.values[1];

  if (!isFmReaction) return;

  // Avoid handling the same message twice when both up+down reactions land
  if (handledMessages.has(message.id)) return;
  handledMessages.add(message.id);
  setTimeout(() => handledMessages.delete(message.id), 60_000);

  const channelId = message.channel.id;
  if (!messageCounters.has(channelId)) {
    messageCounters.set(channelId, REQUIRED_MESSAGES);
  }
  const count = messageCounters.get(channelId);

  if (count < REQUIRED_MESSAGES) {
    try {
      await message.delete();
      console.log(`✅ Deleted FM message from ${isFmBot ? "fmbot" : "bleed"}`);
    } catch (err) {
      console.error("❌ Failed to delete FM message:", err);
    }
    try {
      const warning = await message.channel.send(WARNING_TEXT);
      setTimeout(() => warning.delete().catch(() => { }), 10_000);
    } catch (err) {
      console.error("❌ Failed to send warning:", err);
    }
    return;
  }

  // Allowed → reset the shared counter
  messageCounters.set(channelId, 0);
});

client.login(process.env.DISCORD_TOKEN);