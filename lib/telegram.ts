const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export async function sendTelegramMessage(chatId: number, text: string) {
    if (!BOT_TOKEN) {
        throw new Error("TELEGRAM_BOT_TOKEN is not set");
    }

    const response = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
            }),
        }
    );

    if (!response.ok) {
        const error = await response.text();
        console.error("Telegram API error:", error);
    }

    return response;
}