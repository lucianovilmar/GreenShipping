(async () => {
  try {
    const { apiClient, apiConfig } = require('../src/config/api');
    console.log('Usando baseURL:', apiConfig.baseURL);
    console.log('X-Api-Key presente:', !!apiConfig.apiKey);

    console.log('\n== GET /ports ==');
    try {
      const r = await apiClient.get('/ports');
      console.log('Status:', r.status);
      console.log('Body sample keys:', Object.keys(r.data || {}).slice(0,10));
      console.log('Results count:', (r.data && r.data.data && r.data.data.length) || 0);
    } catch (err) {
      console.error('Erro /ports:', err.response ? { status: err.response.status, data: err.response.data } : err.message);
    }

    console.log('\n== GET /airports ==');
    try {
      const r2 = await apiClient.get('/airports');
      console.log('Status:', r2.status);
      console.log('Body sample keys:', Object.keys(r2.data || {}).slice(0,10));
      console.log('Results count:', (r2.data && r2.data.data && r2.data.data.length) || 0);
    } catch (err) {
      console.error('Erro /airports:', err.response ? { status: err.response.status, data: err.response.data } : err.message);
    }
  } catch (e) {
    console.error('Erro ao carregar apiClient:', e.message);
    process.exit(1);
  }
})();