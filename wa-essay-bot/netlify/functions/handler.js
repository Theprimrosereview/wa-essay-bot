// netlify/functions/handler.js

import fetch from 'node-fetch';

const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;

export async function handler(event, context) {
  if (event.httpMethod === 'GET') {
    const params = event.queryStringParameters;
    if (
      params['hub.mode'] === 'subscribe' &&
      params['hub.verify_token'] === VERIFY_TOKEN
    ) {
      return {
        statusCode: 200,
        body: params['hub.challenge']
      };
    } else {
      return {
        statusCode: 403,
        body: 'Verification failed'
      };
    }
  }

  if (event.httpMethod === 'POST') {
    const body = JSON.parse(event.body);

    const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = message?.from;
    const text = message?.text?.body;

    if (from && text) {
      console.log(`📩 Got message from ${from}: ${text}`);

      // שליחת תשובה לבוט
      await sendWhatsAppMessage(from, `היי 👋 כאן הבוט EVA. קיבלתי את ההודעה שלך: "${text}"`);
    }

    return {
      statusCode: 200,
      body: 'EVENT_RECEIVED'
    };
  }

  return {
    statusCode: 404,
    body: 'Not Found'
  };
}

async function sendWhatsAppMessage(recipientPhoneNumberId, messageText) {
  const response = await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: recipientPhoneNumberId,
      type: 'text',
      text: {
        body: messageText
      }
    })
  });

  const result = await response.json();
  console.log('📤 Sent response:', result);
}
