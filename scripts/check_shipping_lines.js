(async () => {
  require('dotenv').config();
  const fetch = global.fetch || (await import('node-fetch')).default;
  const base = process.env.API_BASE_URL || 'https://external.dati-api.com/teste';
  const key = process.env.API_KEY || '';
  const url = base.replace(/\/$/, '') + '/shipping_lines';

  console.log('GET', url);
  console.log('Using X-Api-Key present?', !!key);

  try {
    const res = await fetch(url, { headers: { 'X-Api-Key': key } });
    const text = await res.text();
    let body = text;
    try { body = JSON.parse(text); } catch (e) {}
    console.log('Status:', res.status);
    console.log('Body:', typeof body === 'object' ? JSON.stringify(body, null, 2).slice(0, 500) : body.slice(0, 200));
  } catch (e) {
    console.error('Request error:', e.message);
  }
})();