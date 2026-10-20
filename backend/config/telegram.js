const { TelegramBot } = require("node-telegram-bot-api");
const path = require("path");
const fs = require("fs");

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: false,
});

const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendAlert(message, imagePath = null) {
  try {
    if (imagePath) {
      const fullPath = path.join(__dirname, "..", imagePath);

      if (fs.existsSync(fullPath)) {
        await bot.sendPhoto(CHAT_ID, fullPath, {
          caption: message,
        });
      } else {
        await bot.sendMessage(CHAT_ID, message);
      }
    } else {
      await bot.sendMessage(CHAT_ID, message);
    }

    console.log("✅ Telegram notification sent.");
  } catch (err) {
    console.error("Telegram Error:", err);
  }
}

module.exports = { sendAlert };