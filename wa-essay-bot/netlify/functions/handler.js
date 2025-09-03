exports.handler = async function (event, context) {
  if (event.httpMethod === 'GET') {
    const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;

    const mode = event.queryStringParameters['hub.mode'];
    const token = event.queryStringParameters['hub.verify_token'];
    const challenge = event.queryStringParameters['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return {
        statusCode: 200,
        body: challenge,
      };
    } else {
      return {
        statusCode: 403,
        body: 'Verification token mismatch',
      };
    }
  }

  return {
    statusCode: 405,
    body: 'Method Not Allowed',
  };
};
