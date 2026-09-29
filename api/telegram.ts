import { Client } from "@upstash/qstash";
import { Redis } from "@upstash/redis";

// Initialize clients
const qstash = new Client({
    token: process.env.QSTASH_TOKEN!,
    baseUrl: process.env.QSTASH_URL || "https://qstash.upstash.io",
});

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Define the Reminder type
interface Reminder {
    id: string;
    qstashId: string;
    text: string;
    timestamp: number;
    formattedTime: string;
}

// Helper: Generate a short unique ID
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// Helper: Send Telegram message
async function sendTelegramMessage(chatId: number, text: string) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is missing");
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
    });
}

export default async function handler(req: any, res: any) {
    try {
        if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

        const message = req.body?.message;
        if (!message || !message.text) return res.status(200).json({ ok: true });

        const chatId = message.chat.id;
        const text: string = message.text.trim();
        const parts = text.split(" ");
        const command = parts[0].toLowerCase();

        // 1. LIST COMMAND
        if (command === "/list") {
            const reminders = await redis.get<Reminder[]>(`reminders:${chatId}`) || [];
            if (reminders.length === 0) {
                await sendTelegramMessage(chatId, "📭 You have no active reminders.");
            } else {
                const list = reminders.map((r) => `• ID: \`${r.id}\`\n  ⏰ ${r.formattedTime}\n   ${r.text}`).join("\n\n");
                await sendTelegramMessage(chatId, `*Your Reminders:*\n\n${list}`);
            }
            return res.status(200).json({ ok: true });
        }

        // 2. CANCEL COMMAND
        if (command === "/cancel") {
            const id = parts[1];
            if (!id) return await sendTelegramMessage(chatId, "Usage: `/cancel <id>`");

            const reminders = await redis.get<Reminder[]>(`reminders:${chatId}`) || [];
            const reminder = reminders.find((r) => r.id === id);

            if (reminder) {
                // Delete from QStash
                await fetch(`https://qstash.upstash.io/v2/schedules/${reminder.qstashId}`, {
                    method: "DELETE",
                    headers: { Authorization: `Bearer ${process.env.QSTASH_TOKEN}` }
                });
                // Remove from Redis
                const updated = reminders.filter((r) => r.id !== id);
                await redis.set(`reminders:${chatId}`, updated);
                await sendTelegramMessage(chatId, `✅ Reminder \`${id}\` canceled.`);
            } else {
                await sendTelegramMessage(chatId, "❌ Reminder not found.");
            }
            return res.status(200).json({ ok: true });
        }

        // 3. EDIT COMMAND
        if (command === "/edit") {
            const id = parts[1];
            const newText = parts.slice(2).join(" ");
            if (!id || !newText) return await sendTelegramMessage(chatId, "Usage: `/edit <id> <new message>`");

            const reminders = await redis.get<Reminder[]>(`reminders:${chatId}`) || [];
            const reminder = reminders.find((r) => r.id === id);

            if (reminder) {
                // Delete old QStash job
                await fetch(`https://qstash.upstash.io/v2/schedules/${reminder.qstashId}`, {
                    method: "DELETE",
                    headers: { Authorization: `Bearer ${process.env.QSTASH_TOKEN}` }
                });

                // Create new QStash job with original time
                const delay = Math.max(0, reminder.timestamp - Math.floor(Date.now() / 1000));
                const newQstash = await qstash.publishJSON({
                    url: `https://${req.headers.host}/api/qstash`,
                    body: { chatId, text: newText, id: reminder.id },
                    delay: delay,
                });

                // Update Redis
                reminder.text = newText;
                reminder.qstashId = newQstash.messageId;
                await redis.set(`reminders:${chatId}`, reminders);

                await sendTelegramMessage(chatId, `✅ Reminder \`${id}\` updated to:\n"${newText}"`);
            } else {
                await sendTelegramMessage(chatId, "❌ Reminder not found.");
            }
            return res.status(200).json({ ok: true });
        }

        // 4. REMIND COMMAND
        if (command === "/remind" || command === "/r") {
            let targetTimestamp = 0;
            let formattedTime = "";
            let reminderText = "";

            // Format A: Absolute Time (YYYY-MM-DD HH:MM Message)
            const absoluteMatch = text.match(/^\/(?:remind|r)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(.+)$/i);
            if (absoluteMatch) {
                const [, date, time, msg] = absoluteMatch;
                targetTimestamp = Math.floor(new Date(`${date}T${time}:00`).getTime() / 1000);
                formattedTime = `${date} at ${time}`;
                reminderText = msg;
            }
            // Format B: Relative Time (10m, 2h, 1d Message)
            else {
                const relativeMatch = text.match(/^\/(?:remind|r)\s+(\d+)([smhd])\s+(.+)$/i);
                if (relativeMatch) {
                    const [, val, unit, msg] = relativeMatch;
                    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
                    const delaySeconds = parseInt(val) * multipliers[unit.toLowerCase()];
                    targetTimestamp = Math.floor(Date.now() / 1000) + delaySeconds;
                    formattedTime = `in ${val}${unit}`;
                    reminderText = msg;
                }
            }

            if (targetTimestamp > 0 && reminderText) {
                const delay = Math.max(0, targetTimestamp - Math.floor(Date.now() / 1000));
                const id = generateId();

                const qstashRes = await qstash.publishJSON({
                    url: `https://${req.headers.host}/api/qstash`,
                    body: { chatId, text: reminderText, id },
                    delay: delay,
                });

                const reminder: Reminder = {
                    id,
                    qstashId: qstashRes.messageId,
                    text: reminderText,
                    timestamp: targetTimestamp,
                    formattedTime
                };

                const reminders = await redis.get<Reminder[]>(`reminders:${chatId}`) || [];
                reminders.push(reminder);
                await redis.set(`reminders:${chatId}`, reminders);

                await sendTelegramMessage(chatId, `✅ Reminder set for ${formattedTime}:\n"${reminderText}"\n\nID: \`${id}\``);
            } else {
                await sendTelegramMessage(chatId, "Usage:\n• `/remind 2026-10-30 14:30 Meeting`\n• `/remind 2h Buy milk`");
            }
        }

        return res.status(200).json({ ok: true });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
}