(async () => {
  const fetch = global.fetch || (await import('node-fetch')).default;
  const key = process.env.API_KEY || '';
  const base = (process.env.API_BASE_URL) || 'https://external.dati-api.com/teste';
  const endpoints = ['/ports','/airports'];
  const variants = [
    { name: 'X-Api-Key header', opts: (ep) => ({ headers: { 'X-Api-Key': key } }) },
    { name: 'Authorization Bearer', opts: (ep) => ({ headers: { 'Authorization': `Bearer ${key}` } }) },
    { name: 'query param', opts: (ep) => ({}) }
  ];

  for (const ep of endpoints) {
    console.log('\n== Testing', ep, '==');
    for (const v of variants) {
      try {
        let url = base + ep;
        if (v.name === 'query param') url = url + `?api_key=${encodeURIComponent(key)}`;
        const opts = v.opts(ep);
        const r = await fetch(url, opts);
        const text = await r.text();
        let parsed;
        try { parsed = JSON.parse(text); } catch (e) { parsed = text; }
        console.log(v.name, '->', r.status, typeof parsed === 'object' ? Object.keys(parsed).slice(0,5) : parsed);
      } catch (e) {
        console.error(v.name, 'error', e.message);
      }
    }
  }
})();