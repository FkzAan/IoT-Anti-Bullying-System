require("dotenv").config();

const { sendAlert } = require("./config/telegram");

(async () => {
  try {
    await sendAlert(
      "✅ Telegram Test Successful!\n\nYour backend can send Telegram messages."
    );
    console.log("Telegram message sent!");
  } catch (err) {
    console.error(err);
  }
})();