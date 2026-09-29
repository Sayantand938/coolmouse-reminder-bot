import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(req: VercelRequest, res: VercelResponse) {
    res.status(200).json({
        status: "Server is alive!",
        environmentCheck: {
            TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ? "✅ Found" : "❌ Missing",
            QSTASH_TOKEN: process.env.QSTASH_TOKEN ? "✅ Found" : "❌ Missing",
            QSTASH_URL: process.env.QSTASH_URL || "❌ Missing"
        }
    });
}