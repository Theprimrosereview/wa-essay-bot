const axios = require("axios");
const { OpenAI } = require("openai");
const { buildPrompt } = require("../../prompt.js");

const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const PHONE_ID = process.env.META_PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
const SITE_URL = process.env.PUBLIC_SITE_URL;
const CTA_UTM = process.env.CTA_UTM || "";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const sessions = {}; // ✅ זיכרון זמני לשיחות

const handler = async (event, context) => {
  try {
    if (event.httpMethod === "GET") {
      const params = new URLSearchParams(event.rawQuery || "");
      const mode = params.get("hub.mode");
      const token = params.get("hub.verify_token");
      const challenge = params.get("hub.challenge");
      if (mode === "subscribe" && token === VERIFY_TOKEN) {
        return { statusCode: 200, body: challenge };
      }
      return { statusCode: 403, body: "Forbidden" };
    }

    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const body = JSON.parse(event.body || "{}");
    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const messages = changes?.value?.messages;
    if (!messages || !messages[0]) return { statusCode: 200, body: "ok" };

    const msg = messages[0];
    const from = msg.from;
    const text = msg.text?.body?.trim() || "";

    // ✅ אם נשלח Prompt now
    if (text.toLowerCase() === "prompt now") {
      const fresh = getOrCreateSession(from);

      const prompt = buildPrompt({
        name: fresh.name || "Student",
        program: fresh.target_program || "your program",
        experience: fresh.signature_experience || "your experience",
        strength: fresh.key_strength || "your strength",
        goals: fresh.goals || "your goals",
        limit: fresh.word_limit || 600,
      });

      await sendText(from, "Creating your draft… this takes around 30 seconds.");

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are EVA, an admissions-essay assistant." },
          { role: "user", content: prompt },
        ],
        temperature: 0.6,
      });

      const draft = completion.choices?.[0]?.message?.content || "Draft unavailable.";
      const chunks = splitMessage(draft, 3500);
      for (const c of chunks) await sendText(from, c);

      const ctaUrl = ${SITE_URL}?${CTA_UTM};
      await sendText(from, Want professional feedback or polishing for ${fresh.target_program || "your program"}? Visit: ${ctaUrl});
      updateSession(from, { step: "delivered" });

      return { statusCode: 200, body: "ok" };
    }

    // ✅ המשך תהליך רגיל
    const session = getOrCreateSession(from);
    const { step } = session;

    const reply = async (t) => {
      await sendText(from, t);
    };

    if (step === "welcome") {
      updateSession(from, { step: "q1_name" });
      await reply("Hi! I’m EVA.\nLet’s write a short admissions essay in 3 quick steps. Ready to begin? (Yes/No)");
      return { statusCode: 200, body: "ok" };
    }

    if (step === "q1_name") {
      const name = text || "Student";
      updateSession(from, { name, step: "q2_program" });
      await reply(Nice to meet you, ${name}! What university or program is this essay for?);
      return { statusCode: 200, body: "ok" };
    }

    if (step === "q2_program") {
      updateSession(from, { target_program: text, step: "q3_experience" });
      await reply("Tell me about one meaningful experience you’d like to include (1–2 sentences).");
      return { statusCode: 200, body: "ok" };
    }

    if (step === "q3_experience") {
      updateSession(from, { signature_experience: text, step: "q4_strength" });
      await reply("What’s a personal strength or value that best describes you?");
      return { statusCode: 200, body: "ok" };
    }

    if (step === "q4_strength") {
      updateSession(from, { key_strength: text, step: "q5_goals" });
      await reply("What are your academic or career goals for the next 3–5 years?");
      return { statusCode: 200, body: "ok" };
    }

    if (step === "q5_goals") {
      updateSession(from, { goals: text, step: "confirm_generate" });
      await reply('Want me to generate a draft based on your answers? Type "yes" to confirm.');
      return { statusCode: 200, body: "ok" };
    }

    if (step === "confirm_generate") {
      if (!/^yes$|^y$/i.test(text)) {
        await reply('Please confirm by typing "yes" so I can start drafting.');
        return { statusCode: 200, body: "ok" };
      }
      updateSession(from, { step: "generating" });
      await reply("Creating your draft… this takes around 30 seconds.");

      const fresh = getOrCreateSession(from);
      const prompt = buildPrompt({
        name: fresh.name,
        program: fresh.target_program,
        experience: fresh.signature_experience,
        strength: fresh.key_strength,
        goals: fresh.goals,
        limit: fresh.word_limit || 600,
      });

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are EVA, an admissions-essay assistant." },
          { role: "user", content: prompt },
        ],
        temperature: 0.6,
      });

      const draft = completion.choices?.[0]?.message?.content || "Draft unavailable.";
      const chunks = splitMessage(draft, 3500);
      for (const c of chunks) await reply(c);

      const ctaUrl = ${SITE_URL}?${CTA_UTM};
      await reply(Want professional feedback or polishing for ${fresh.target_program || "your program"}? Visit: ${ctaUrl});
      updateSession(from, { step: "delivered" });
      return { statusCode: 200, body: "ok" };
    }

    await reply("Let’s pick up where we left off.");
    return { statusCode: 200, body: "ok" };

  } catch (e) {
    console.error(e);
    return { statusCode: 200, body: "ok" };
  }
};

// === 📦 פונקציות עזר ===

async function callMeta(method, url, data) {
  const base = https://graph.facebook.com/v17.0/${url};
  return axios({ method, url: base, data, headers: { Authorization: Bearer ${ACCESS_TOKEN} } });
}

async function sendText(to, text) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };

  try {
    const res = await callMeta("POST", ${PHONE_ID}/messages, payload);
    console.log("✅ Message sent:", res.data);
  } catch (err) {
    console.error("❌ Failed to send WhatsApp message:", err?.response?.data || err.message || err);
  }
}

function splitMessage(str, max = 3500) {
  const parts = [];
  for (let i = 0; i < str.length; i += max) parts.push(str.slice(i, i + max));
  return parts;
}

function getOrCreateSession(msisdn) {
  if (!sessions[msisdn]) {
    sessions[msisdn] = { step: "welcome" };
  }
  return sessions[msisdn];
}

function updateSession(msisdn, patch) {
  sessions[msisdn] = { ...sessions[msisdn], ...patch };
}

// ✅ export בסוף בלבד
module.exports = { handler };
