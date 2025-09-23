
// ai-handler.js — unified router (CJS) — FINAL
const { GoogleGenerativeAI } = require("@google/generative-ai");

/** Build system prompts; use affiliate IDs only if provided */
function buildPrompts(env, payload = {}) {
  const have = (k) => !!env[k];
  const affiliateInstruction =
    (have("SHOPEE_AFFILIATE_ID") || have("LAZADA_AFFILIATE_ID") || have("TIKTOK_AFFILIATE_ID") || have("INVOLVE_ASIA_ID"))
      ? `
CRITICAL MONETIZATION: When you share a product link, append affiliate params when applicable (skip silently if not applicable):
• Shopee: &aff_sub1=${env.SHOPEE_AFFILIATE_ID || ""}
• Lazada: &sub_id1=${env.LAZADA_AFFILIATE_ID || ""}
• TikTok Shop: &aff_sub_id1=${env.TIKTOK_AFFILIATE_ID || ""}
• Other MY stores: use InvolveAsia deeplink if known: https://app.involve.asia/publisher/programs (skip if unknown).
Do not say you use affiliate links.`
      : ``;

  return {
    "deal-assassin": `You are the 'Deal Assassin' for Malaysia. Find value-for-money laptops and accessories in MYR.
Return clean, concise text with bullet points (no tables). ${affiliateInstruction}`,
    "getFutureIntel": `You are a tech trend analyst for SE Asia. Output ONLY valid JSON with this shape:
{"summary": "string", "signals": [{"title":"", "why_it_matters":""}], "confidence": "low|med|high"}
No markdown, no backticks.`,
    "generic": payload.systemPrompt || "You are a concise helpful assistant."
  };
}

function mapTask(eventPath, rawTask) {
  const p = (eventPath || "").toLowerCase();
  const t = (rawTask || "").toLowerCase();
  const alias = {
    "getmarketintel": "deal-assassin",
    "getfutureintel": "getFutureIntel",
    "default": "generic"
  };
  return alias[t] || rawTask || (p.endsWith("/getmarketintel") ? "deal-assassin"
       : p.endsWith("/getfutureintel") ? "getFutureIntel"
       : p.endsWith("/callgemini") ? "generic"
       : "generic");
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    const taskKey = mapTask(event.path, payload.task);

    // Health-check task (no keys required)
    if (taskKey === "ping") {
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true, pong: true }) };
    }

    // Require only GEMINI_API_KEY for all tasks
    if (!process.env.GEMINI_API_KEY) {
      return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "GEMINI_API_KEY missing" }) };
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const prompts = buildPrompts(process.env, payload);
    const systemInstruction = prompts[taskKey];

    if (!systemInstruction) {
      return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: `Unknown task: ${taskKey}` }) };
    }

    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || "gemini-1.5-pro-latest",
      systemInstruction
    });

    const userPrompt = payload.userPrompt && String(payload.userPrompt).trim();
    const contentToGenerate = userPrompt ? userPrompt : systemInstruction;

    const result = await model.generateContent(contentToGenerate);
    const resp = await result.response;
    const text = resp.text();

    if (taskKey === "getFutureIntel") {
      // Try strict JSON; if parse fails, fallback
      try {
        const json = JSON.parse(text);
        return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(json) };
      } catch (_) {
        return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) };
      }
    }

    // Generic / deal-assassin etc. → return plain text
    return { statusCode: 200, headers: { "Content-Type": "text/plain; charset=utf-8" }, body: text };
  } catch (err) {
    console.error("ai-handler error:", err);
    return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "server_error", details: String(err && err.message || err) }) };
  }
};
