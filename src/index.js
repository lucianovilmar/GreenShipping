require('dotenv').config();
const express = require('express');
const path = require('path');
const logger = require('./config/logger');
const maritimoApiService = require('./services/maritimoApiService');
const aereoApiService = require('./services/aereoApiService');

const app = express();
const port = parseInt(process.env.PORT, 10) || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// Helper: formata resposta conforme especificação DA TI
function envelope(success, data = {}, errors = [], warnings = []) {
  return {
    success: !!success,
    data: data === undefined ? {} : data,
    user: null,
    errors: Array.isArray(errors) ? errors : [String(errors)],
    warnings: Array.isArray(warnings) ? warnings : [String(warnings)].filter(Boolean)
  };
}

app.post('/api/maritimo/put', async (req, res) => {
  const payload = req.body;
  logger.info('Recebido formulário Marítimo', { bodyKeys: Object.keys(payload) });

  try {
    const result = await maritimoApiService.sendMaritimoPut(payload);
    return res.status(result.statusCode || 200).json(envelope(true, result.data || {}, [], []));
  } catch (error) {
    const statusCode = error.response?.status || 500;
    const errorData = error.response?.data || error.message;

    logger.error('Falha no PUT Marítimo', { statusCode, error: errorData });
    const errors = [];
    if (errorData && typeof errorData === 'object') {
      if (errorData.message) errors.push(String(errorData.message));
      else errors.push(JSON.stringify(errorData));
    } else {
      errors.push(String(errorData));
    }

    return res.status(statusCode).json(envelope(false, {}, errors));
  }
});

app.post('/api/aereo/put', async (req, res) => {
  const payload = req.body;
  logger.info('Recebido formulário Aéreo', { bodyKeys: Object.keys(payload) });

  try {
    const result = await aereoApiService.sendAereoPut(payload);
    return res.status(result.statusCode || 200).json(envelope(true, result.data || {}, [], []));
  } catch (error) {
    const statusCode = error.response?.status || 500;
    const errorData = error.response?.data || error.message;

    logger.error('Falha no PUT Aéreo', { statusCode, error: errorData });
    const errors = [];
    if (errorData && typeof errorData === 'object') {
      if (errorData.message) errors.push(String(errorData.message));
      else errors.push(JSON.stringify(errorData));
    } else {
      errors.push(String(errorData));
    }

    return res.status(statusCode).json(envelope(false, {}, errors));
  }
});

app.get('/api/portos', async (req, res) => {
  const { q } = req.query;
  logger.info('Buscando portos da API', { search: q });

  try {
    const { apiClient } = require('./config/api');
    const endpoint = '/ports';
    
    const response = await apiClient.get(endpoint);
    let portos = response.data?.data || [];

    // Filtra por termo de busca se fornecido
    if (q && q.trim()) {
      const searchTerm = q.toLowerCase();
      portos = portos.filter(p => 
        (p.name && p.name.toLowerCase().includes(searchTerm)) ||
        (p.codigo && p.codigo.toLowerCase().includes(searchTerm)) ||
        (p.id && p.id.toString().includes(searchTerm))
      );
    }

    // Se não há busca, retorna até 50 resultados; se há busca, retorna até 20
    const limit = q ? 20 : 50;
    portos = portos.slice(0, limit);

    return res.json(envelope(true, portos, [], []));
  } catch (error) {
    logger.error('Erro ao buscar portos', { message: error.message });
    // Tentar fallback local
    try {
      const fallback = require('./config/portos-fallback.json');
      const list = (q && q.trim()) ? fallback.filter(p => (p.name && p.name.toLowerCase().includes(q.toLowerCase())) || (p.codigo && p.codigo.toLowerCase().includes(q.toLowerCase())) || (p.id && p.id.toString().includes(q))) : fallback;
      return res.json(envelope(true, list.slice(0, q ? 20 : 50), [], ['fallback']));
    } catch (e2) {
      return res.status(500).json(envelope(false, {}, [String(error.message)]));
    }
  }
});

app.get('/api/aeroportos', async (req, res) => {
  const { q } = req.query;
  logger.info('Buscando aeroportos da API', { search: q });

  try {
    const { apiClient } = require('./config/api');
    const endpoint = '/airports';
    
    const response = await apiClient.get(endpoint);
    let aeroportos = response.data?.data || [];

    // Filtra por termo de busca se fornecido
    if (q && q.trim()) {
      const searchTerm = q.toLowerCase();
      aeroportos = aeroportos.filter(a => 
        (a.name && a.name.toLowerCase().includes(searchTerm)) ||
        (a.codigo && a.codigo.toLowerCase().includes(searchTerm)) ||
        (a.id && a.id.toString().includes(searchTerm))
      );
    }

    // Se não há busca, retorna até 50 resultados; se há busca, retorna até 20
    const limit = q ? 20 : 50;
    aeroportos = aeroportos.slice(0, limit);

    return res.json(envelope(true, aeroportos, [], []));
  } catch (error) {
    logger.error('Erro ao buscar aeroportos', { message: error.message });
    // Tentar fallback local
    try {
      const fallback = require('./config/aeroportos-fallback.json');
      const list = (q && q.trim()) ? fallback.filter(a => (a.name && a.name.toLowerCase().includes(q.toLowerCase())) || (a.codigo && a.codigo.toLowerCase().includes(q.toLowerCase())) || (a.id && a.id.toString().includes(q))) : fallback;
      return res.json(envelope(true, list.slice(0, q ? 20 : 50), [], ['fallback']));
    } catch (e2) {
      return res.status(500).json(envelope(false, {}, [String(error.message)]));
    }
  }
});

app.get('/api/shipping-lines', async (req, res) => {
  const { q } = req.query;
  logger.info('Buscando companhias de transporte da API', { search: q });

  try {
    const { apiClient } = require('./config/api');
    const endpoint = '/shipping_lines';
    
    const response = await apiClient.get(endpoint);
    let companies = response.data?.data || [];

    // Filtra por termo de busca se fornecido
    if (q && q.trim()) {
      const searchTerm = q.toLowerCase();
      companies = companies.filter(c => 
        (c.name && c.name.toLowerCase().includes(searchTerm)) ||
        (c.codigo && c.codigo.toLowerCase().includes(searchTerm)) ||
        (c.id && c.id.toString().includes(searchTerm))
      );
    }

    // Se não há busca, retorna até 50 resultados; se há busca, retorna até 20
    const limit = q ? 20 : 50;
    companies = companies.slice(0, limit);

    return res.json(envelope(true, companies, [], []));
  } catch (error) {
    logger.error('Erro ao buscar companhias de transporte', { message: error.message });
    // Tentar fallback local
    try {
      const fallback = require('./config/shipping-lines-fallback.json');
      const list = (q && q.trim()) ? fallback.filter(c => (c.name && c.name.toLowerCase().includes(q.toLowerCase())) || (c.codigo && c.codigo.toLowerCase().includes(q.toLowerCase())) || (c.id && c.id.toString().includes(q))) : fallback;
      return res.json(envelope(true, list.slice(0, q ? 20 : 50), [], ['fallback']));
    } catch (e2) {
      return res.status(500).json(envelope(false, {}, [String(error.message)]));
    }
  }
});

app.get('/api/navios', async (req, res) => {
  const { q } = req.query;
  logger.info('Buscando navios da API', { search: q });

  try {
    const { apiClient } = require('./config/api');
    const endpoint = '/vessel';
    
    const response = await apiClient.get(endpoint);
    let vessels = response.data;
    if (vessels && vessels.data) {
      vessels = vessels.data;
    }
    if (!Array.isArray(vessels)) {
      vessels = [];
    }

    // Filtra por termo de busca se fornecido
    if (q && q.trim()) {
      const searchTerm = q.toLowerCase();
      vessels = vessels.filter(v => 
        (v.name && v.name.toLowerCase().includes(searchTerm)) ||
        (v.code && v.code.toLowerCase().includes(searchTerm)) ||
        (v.id && v.id.toString().includes(searchTerm))
      );
    }

    // Se não há busca, retorna até 50 resultados; se há busca, retorna até 20
    const limit = q ? 20 : 50;
    vessels = vessels.slice(0, limit);

    return res.json(envelope(true, vessels, [], []));
  } catch (error) {
    logger.error('Erro ao buscar navios da API', { message: error.message });
    // Tentar fallback local
    try {
      const fallback = require('./config/navios-fallback.json');
      const list = (q && q.trim()) ? fallback.filter(v => (v.name && v.name.toLowerCase().includes(q.toLowerCase())) || (v.code && v.code.toLowerCase().includes(q.toLowerCase())) || (v.id && v.id.toString().includes(q))) : fallback;
      return res.json(envelope(true, list.slice(0, q ? 20 : 50), [], ['fallback']));
    } catch (e2) {
      return res.status(500).json(envelope(false, {}, [String(error.message)]));
    }
  }
});

app.get('/api/armazens', async (req, res) => {
  const { q } = req.query;
  logger.info('Buscando armazens da API', { search: q });

  try {
    const { apiClient } = require('./config/api');
    const endpoint = '/warehouses';
    
    const response = await apiClient.get(endpoint);
    let warehouses = response.data;
    if (warehouses && warehouses.data) {
      warehouses = warehouses.data;
    }
    if (!Array.isArray(warehouses)) {
      warehouses = [];
    }

    // Filtra por termo de busca se fornecido
    if (q && q.trim()) {
      const searchTerm = q.toLowerCase();
      warehouses = warehouses.filter(w => 
        (w.name && w.name.toLowerCase().includes(searchTerm)) ||
        (w.recinto && w.recinto.toString().includes(searchTerm)) ||
        (w.id && w.id.toString().includes(searchTerm))
      );
    }

    // Se não há busca, retorna até 50 resultados; se há busca, retorna até 20
    const limit = q ? 20 : 50;
    warehouses = warehouses.slice(0, limit);

    return res.json(envelope(true, warehouses, [], []));
  } catch (error) {
    logger.error('Erro ao buscar armazens da API', { message: error.message });
    // Tentar fallback local
    try {
      const fallback = require('./config/armazens-fallback.json');
      const list = (q && q.trim()) ? fallback.filter(w => (w.name && w.name.toLowerCase().includes(q.toLowerCase())) || (w.recinto && w.recinto.toString().includes(q)) || (w.id && w.id.toString().includes(q))) : fallback;
      return res.json(envelope(true, list.slice(0, q ? 20 : 50), [], ['fallback']));
    } catch (e2) {
      return res.status(500).json(envelope(false, {}, [String(error.message)]));
    }
  }
});

app.get('/api/valores-padrao', (req, res) => {
  try {
    const data = require('./config/tabelas-valores.json');
    return res.json(envelope(true, data, [], []));
  } catch (error) {
    logger.error('Erro ao ler tabelas-valores.json', { error: error.message });
    return res.status(500).json(envelope(false, {}, [String(error.message)]));
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function startServer(attemptPort = port, maxAttempts = 5, attempt = 1) {
  const server = app.listen(attemptPort, () => {
    logger.info(`Servidor de formulário Marítimo e Aéreo iniciado em http://localhost:${attemptPort}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && attempt < maxAttempts) {
      const nextPort = attemptPort + 1;
      logger.warn(`Porta ${attemptPort} ocupada. Tentando porta ${nextPort}...`);
      startServer(nextPort, maxAttempts, attempt + 1);
      return;
    }

    if (error.code === 'EADDRINUSE') {
      logger.error(`Não foi possível iniciar o servidor. Portas ${attemptPort - maxAttempts + 1} a ${attemptPort} estão ocupadas.`);
    } else {
      logger.error('Erro ao iniciar o servidor', { message: error.message });
    }
    process.exit(1);
  });
}

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  startServer();
}

module.exports = app;
