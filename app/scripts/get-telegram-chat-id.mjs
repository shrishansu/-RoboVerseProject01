const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error("Set TELEGRAM_BOT_TOKEN in the current shell before running this helper.");
  process.exitCode = 1;
} else {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok !== true) {
      console.error(`Telegram getUpdates failed (HTTP ${response.status}). Check the bot setup and token.`);
      process.exitCode = 1;
    } else {
      const chats = new Map();
      for (const update of result.result || []) {
        const message = update.message || update.edited_message || update.channel_post || update.edited_channel_post;
        const chat = message?.chat;
        if (!chat || chat.id === undefined || chats.has(String(chat.id))) continue;
        const person = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ");
        chats.set(String(chat.id), {
          id: String(chat.id),
          label: person || chat.title || "Telegram chat",
          username: message.from?.username || "",
        });
      }

      if (chats.size === 0) {
        console.log("No chat updates found. Send a message to the bot first, then run this helper again.");
      } else {
        for (const chat of chats.values()) {
          console.log(`${chat.id}\t${chat.label}${chat.username ? ` (@${chat.username})` : ""}`);
        }
      }
    }
  } catch {
    console.error("Could not contact Telegram getUpdates. Check network access and try again.");
    process.exitCode = 1;
  }
}
