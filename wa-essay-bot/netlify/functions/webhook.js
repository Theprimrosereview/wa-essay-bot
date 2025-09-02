import axios from "axios";
import { OpenAI } from "openai";
import { supabase } from "../../lib/supabaseClient.js";
import { buildPrompt } from "../../prompt.js";

const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const PHONE_ID = process.env.META_PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
const SITE_URL = process.env.PUBLIC_SITE_URL;
const CTA_UTM = process.env.CTA_UTM || "";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function handler(event, context) {
  try {
    // WhatsApp webhook verification (GET)
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

    // Messages webhook (POST)
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

    await logMessage(from, "in", text, msg);

    const session = await getOrCreateSession(from);
    const { step } = session;

    const reply = async (t) => {
      await sendText(from, t);
      await logMessage(from, "out", t);
    };

    if (step === "welcome") {
      await updateSession(from, { step: "q1_name" });
      await reply("היי! אני EVA\nנכין יחד טיוטת חיבור קצרה ב-3 שלבים. מוכן/נה? (כן/לא)");
      return { statusCode: 200, body: "ok" };
    }

    if (step === "q1_name") {
      const name = text || "Student";
      await updateSession(from, { name, step: "q2_program" });
      await reply(`נעים להכיר, ${name}! לאיזו תוכנית/אוניברסיטה מיועד החיבור?`);
      return { statusCode: 200, body: "ok" };
    }

    if (step === "q2_program") {
      await updateSession(from, { target_program: text, step: "q3_experience" });
      await reply("ספר/י על חוויה אחת משמעותית שתרצה/י לשלב (משפט-שניים).");
      return { statusCode: 200, body: "ok" };
    }

    if (step === "q3_experience") {
      await updateSession(from, { signature_experience: text, step: "q4_strength" });
      await reply("איזו יכולת/ערך מרכזי הכי מאפיין אותך?");
      return { statusCode: 200, body: "ok" };
    }

    if (step === "q4_strength") {
      await updateSession(from, { key_strength: text, step: "q5_goals" });
      await reply("מה המטרה האקדמית/קרייריסטית שלך ל-3–5 השנים הקרובות?");
      return { statusCode: 200, body: "ok" };
    }

    if (step === "q5_goals") {
      await updateSession(from, { goals: text, step: "confirm_generate" });
      await reply('להפיק טיוטה על בסיס התשובות? הקלד/י "כן" כדי לאשר.');
      return { statusCode: 200, body: "ok" };
    }

    if (step === "confirm_generate") {
      if (!/^כן$|^y(es)?$/i.test(text)) {
        await reply('אשר/י ב-"כן" כדי להפיק טיוטה.');
        return { statusCode: 200, body: "ok" };
      }
      await updateSession(from, { step: "generating" });
      await reply("מכין טיוטה… זה לוקח כחצי דקה.");

      const fresh = await getOrCreateSession(from);
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

      const ctaUrl = `${SITE_URL}?${CTA_UTM}`;
      await reply(`רוצה שנלטש לפי דרישות ${fresh.target_program || "היעד"} + בדיקת עורך מקצועי? בקר/י באתר: ${ctaUrl}`);
      await updateSession(from, { step: "delivered" });
      return { statusCode: 200, body: "ok" };
    }

    // Fallback
    await reply("נמשיך מהיכן שהגענו.");
    return { statusCode: 200, body: "ok" };
  } catch (e) {
    console.error(e);
    // אל תכשיל את וואטסאפ – החזר 200 גם בשגיאות
    return { statusCode: 200, body: "ok" };
  }
}

// —— Helpers ——

async function callMeta(method, url, data) {
  const base = `https://graph.facebook.com/v21.0/${url}`;
  return axios({ method, url: base, data, headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } });
}

async function sendText(to, text) {
  const payload = { messaging_product: "whatsapp", to, type: "text", text: { body: text } };
  await callMeta("POST", `${PHONE_ID}/messages`, payload);
}

function splitMessage(str, max = 3500) {
  const parts = [];
  for (let i = 0; i < str.length; i += max) parts.push(str.slice(i, i + max));
  return parts;
}

async function getOrCreateSession(msisdn) {
  const { data, error } = await supabase
    .from("wa_sessions")
    .select("*")
    .eq("msisdn", msisdn)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const { data: created, error: insertErr } = await supabase
    .from("wa_sessions")
    .insert({ msisdn, step: "welcome" })
    .select("*")
    .single();
  if (insertErr) throw insertErr;
  return created;
}

async function updateSession(msisdn, patch) {
  patch.updated_at = new Date().toISOString();
  const { error } = await supabase.from("wa_sessions").update(patch).eq("msisdn", msisdn);
  if (error) console.error("updateSession error:", error);
}

async function logMessage(msisdn, direction, message_text, meta) {
  const { error } = await supabase.from("wa_messages").insert({ msisdn, direction, message_text, meta });
  if (error) console.error("logMessage error:", error);
}
