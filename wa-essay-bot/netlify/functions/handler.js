export async function handler(event, context) {
  if (event.httpMethod === 'GET') {
    // שלב האימות מול Meta
    const params = event.queryStringParameters;
    const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;

    if (params['hub.mode'] === 'subscribe' &&
        params['hub.verify_token'] === VERIFY_TOKEN) {
      return {
        statusCode: 200,
        body: params['hub.challenge']
      };
    } else {
      return {
        statusCode: 403,
        body: 'Forbidden'
      };
    }
  }

  if (event.httpMethod === 'POST') {
    // שלב קבלת הודעה מ-WhatsApp
    const body = JSON.parse(event.body);
    console.log('📩 Webhook POST payload:', JSON.stringify(body, null, 2));

    // כאן תוכל להתחיל את הלוגיקה: ניתוח המסר, קריאה ל-OpenAI, שליחה חזרה
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
