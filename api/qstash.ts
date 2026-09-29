import { Redis } from "@upstash/redis";

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

interface Reminder {
    id: string;
    qstashId: string;
    text: string;
    timestamp: number;
    formattedTime: string;
}

export default async function handler(req: any, res: any) {
    try {
        if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

        const { chatId, text, id } = req.body;

        if (!chatId || !text) return res.status(400).json({ error: "Missing data" });

        // 1. Send the reminder to the user
        const token = process.env.TELEGRAM_BOT_TOKEN;
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text: `⏰ *Reminder:*\n\n${text}`,
                parse_mode: "Markdown"
            }),
        });

        // 2. Remove it from the database so /list stays clean
        if (id) {
            const reminders = await redis.get<Reminder[]>(`reminders:${chatId}`) || [];
            const updated = reminders.filter((r) => r.id !== id);
            await redis.set(`reminders:${chatId}`, updated);
        }

        return res.status(200).json({ ok: true });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
}