require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
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

// Função auxiliar para salvar o histórico de envio
async function salvarHistorico(tipo, payload, status) {
  try {
    const dataAtual = new Date();
    const anoMes = dataAtual.toISOString().slice(0, 7); // "YYYY-MM"
    const pad = (num) => String(num).padStart(2, '0');
    const dataHoraStr = `${dataAtual.getFullYear()}-${pad(dataAtual.getMonth() + 1)}-${pad(dataAtual.getDate())} ${pad(dataAtual.getHours())}:${pad(dataAtual.getMinutes())}:${pad(dataAtual.getSeconds())}`;

    const dirPath = path.join(__dirname, 'data', 'history');
    await fs.mkdir(dirPath, { recursive: true });

    const fileName = `${tipo}-${anoMes}.json`;
    const filePath = path.join(dirPath, fileName);

    let registros = [];
    try {
      const content = await fs.readFile(filePath, 'utf8');
      registros = JSON.parse(content);
      if (!Array.isArray(registros)) {
        registros = [];
      }
    } catch (err) {
      registros = [];
    }

    const novoRegistro = {
      id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
      dataHoraEnvio: dataHoraStr,
      status: status,
      payload: payload
    };

    registros.unshift(novoRegistro); // Insere no início do histórico

    await fs.writeFile(filePath, JSON.stringify(registros, null, 2), 'utf8');
    logger.info('Histórico salvo com sucesso', { tipo, fileName });
  } catch (error) {
    logger.error('Falha ao salvar histórico', { error: error.message });
  }
}

app.post('/api/maritimo/put', async (req, res) => {
  const payload = req.body;
  logger.info('Recebido formulário Marítimo', { bodyKeys: Object.keys(payload) });

  try {
    const result = await maritimoApiService.sendMaritimoPut(payload);
    await salvarHistorico('maritimo', payload, 'sucesso');
    return res.status(result.statusCode || 200).json(envelope(true, result.data || {}, [], []));
  } catch (error) {
    const statusCode = error.response?.status || 500;
    const errorData = error.response?.data || error.message;

    logger.error('Falha no PUT Marítimo', { statusCode, error: errorData });
    await salvarHistorico('maritimo', payload, 'erro');
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
    await salvarHistorico('aereo', payload, 'sucesso');
    return res.status(result.statusCode || 200).json(envelope(true, result.data || {}, [], []));
  } catch (error) {
    const statusCode = error.response?.status || 500;
    const errorData = error.response?.data || error.message;

    logger.error('Falha no PUT Aéreo', { statusCode, error: errorData });
    await salvarHistorico('aereo', payload, 'erro');
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

app.get('/api/historico', async (req, res) => {
  const { tipo, processo, data } = req.query;

  if (!tipo || (tipo !== 'maritimo' && tipo !== 'aereo')) {
    return res.status(400).json(envelope(false, {}, ['O parâmetro "tipo" (maritimo ou aereo) é obrigatório.']));
  }

  logger.info('Buscando histórico', { tipo, processo, data });

  try {
    const dirPath = path.join(__dirname, 'data', 'history');
    await fs.mkdir(dirPath, { recursive: true });

    const files = await fs.readdir(dirPath);
    const filteredFiles = files.filter(file => file.startsWith(`${tipo}-`) && file.endsWith('.json'));

    let todosRegistros = [];

    for (const file of filteredFiles) {
      try {
        const content = await fs.readFile(path.join(dirPath, file), 'utf8');
        const registros = JSON.parse(content);
        if (Array.isArray(registros)) {
          todosRegistros = todosRegistros.concat(registros);
        }
      } catch (err) {
        logger.error(`Erro ao ler arquivo de histórico ${file}`, { error: err.message });
      }
    }

    // Ordenar por dataHoraEnvio descrescente
    todosRegistros.sort((a, b) => {
      return new Date(b.dataHoraEnvio.replace(' ', 'T')) - new Date(a.dataHoraEnvio.replace(' ', 'T'));
    });

    let resultados = todosRegistros;

    if (processo && processo.trim()) {
      const searchProc = processo.toLowerCase().trim();
      resultados = resultados.filter(reg => {
        const payloadData = reg.payload.data || reg.payload;
        const numProc = payloadData.numeroProcesso || '';
        return String(numProc).toLowerCase().includes(searchProc);
      });
    }

    if (data && data.trim()) {
      const searchData = data.trim();
      resultados = resultados.filter(reg => reg.dataHoraEnvio.startsWith(searchData));
    }

    return res.json(envelope(true, resultados, [], []));
  } catch (error) {
    logger.error('Erro ao ler histórico', { error: error.message });
    return res.status(500).json(envelope(false, {}, [String(error.message)]));
  }
});

app.get('/api/seaports', async (req, res) => {
  const { q } = req.query;
  logger.info('Buscando portos da API', { search: q });

  try {
    const { apiClient } = require('./config/api');
    const endpoint = '/seaports';
    
    const response = await apiClient.get(endpoint);
    let portos = response.data;
    if (portos && portos.data) {
      portos = portos.data;
    }
    if (!Array.isArray(portos)) {
      portos = [];
    }

    // Filtra por termo de busca se fornecido
    if (q && q.trim()) {
      const searchTerm = q.toLowerCase();
      portos = portos.filter(p => 
        (p.name && p.name.toLowerCase().includes(searchTerm)) ||
        (p.sigla && p.sigla.toLowerCase().includes(searchTerm)) ||
        (p.codigo && p.codigo.toLowerCase().includes(searchTerm)) ||
        (p.country && p.country.toLowerCase().includes(searchTerm)) ||
        (p.city && p.city.toLowerCase().includes(searchTerm)) ||
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
      const list = (q && q.trim()) ? fallback.filter(p => 
        (p.name && p.name.toLowerCase().includes(q.toLowerCase())) || 
        (p.sigla && p.sigla.toLowerCase().includes(q.toLowerCase())) || 
        (p.codigo && p.codigo.toLowerCase().includes(q.toLowerCase())) || 
        (p.country && p.country.toLowerCase().includes(q.toLowerCase())) || 
        (p.city && p.city.toLowerCase().includes(q.toLowerCase())) || 
        (p.id && p.id.toString().includes(q))
      ) : fallback;
      return res.json(envelope(true, list.slice(0, q ? 20 : 50), [], ['fallback']));
    } catch (e2) {
      return res.status(500).json(envelope(false, {}, [String(error.message)]));
    }
  }
});

app.get('/api/airports', async (req, res) => {
  const { q } = req.query;
  logger.info('Buscando aeroportos da API', { search: q });

  try {
    const { apiClient } = require('./config/api');
    const endpoint = '/airports';
    
    const response = await apiClient.get(endpoint);
    let aeroportos = response.data;
    if (aeroportos && aeroportos.data) {
      aeroportos = aeroportos.data;
    }
    if (!Array.isArray(aeroportos)) {
      aeroportos = [];
    }

    // Filtra por termo de busca se fornecido
    if (q && q.trim()) {
      const searchTerm = q.toLowerCase();
      aeroportos = aeroportos.filter(a => 
        (a.name && a.name.toLowerCase().includes(searchTerm)) ||
        (a.sigla && a.sigla.toLowerCase().includes(searchTerm)) ||
        (a.codigo && a.codigo.toLowerCase().includes(searchTerm)) ||
        (a.country && a.country.toLowerCase().includes(searchTerm)) ||
        (a.city && a.city.toLowerCase().includes(searchTerm)) ||
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
      const list = (q && q.trim()) ? fallback.filter(a => 
        (a.name && a.name.toLowerCase().includes(q.toLowerCase())) || 
        (a.sigla && a.sigla.toLowerCase().includes(q.toLowerCase())) || 
        (a.codigo && a.codigo.toLowerCase().includes(q.toLowerCase())) || 
        (a.country && a.country.toLowerCase().includes(q.toLowerCase())) || 
        (a.city && a.city.toLowerCase().includes(q.toLowerCase())) || 
        (a.id && a.id.toString().includes(q))
      ) : fallback;
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
    let companies = response.data;
    if (companies && companies.data) {
      companies = companies.data;
    }
    if (!Array.isArray(companies)) {
      companies = [];
    }

    // Filtra por termo de busca se fornecido
    if (q && q.trim()) {
      const searchTerm = q.toLowerCase();
      companies = companies.filter(c => 
        (c.name && c.name.toLowerCase().includes(searchTerm)) ||
        (c.codigo && c.codigo.toLowerCase().includes(searchTerm)) ||
        (c.owner_code && c.owner_code.toLowerCase().includes(searchTerm)) ||
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
      const list = (q && q.trim()) ? fallback.filter(c => (c.name && c.name.toLowerCase().includes(q.toLowerCase())) || (c.codigo && c.codigo.toLowerCase().includes(q.toLowerCase())) || (c.owner_code && c.owner_code.toLowerCase().includes(q.toLowerCase())) || (c.id && c.id.toString().includes(q))) : fallback;
      return res.json(envelope(true, list.slice(0, q ? 20 : 50), [], ['fallback']));
    } catch (e2) {
      return res.status(500).json(envelope(false, {}, [String(error.message)]));
    }
  }
});

app.get('/api/airlines', async (req, res) => {
  const { q } = req.query;
  logger.info('Buscando companhias aéreas da API', { search: q });

  try {
    const { apiClient } = require('./config/api');
    const endpoint = '/airlines';
    
    const response = await apiClient.get(endpoint);
    let airlines = response.data;
    if (airlines && airlines.data) {
      airlines = airlines.data;
    }
    if (!Array.isArray(airlines)) {
      airlines = [];
    }

    // Filtra por termo de busca se fornecido
    if (q && q.trim()) {
      const searchTerm = q.toLowerCase();
      airlines = airlines.filter(c => 
        (c.name && c.name.toLowerCase().includes(searchTerm)) ||
        (c.code && c.code.toLowerCase().includes(searchTerm)) ||
        (c.country_name && c.country_name.toLowerCase().includes(searchTerm)) ||
        (c.id && c.id.toString().includes(searchTerm))
      );
    }

    // Se não há busca, retorna até 50 resultados; se há busca, retorna até 20
    const limit = q ? 20 : 50;
    airlines = airlines.slice(0, limit);

    return res.json(envelope(true, airlines, [], []));
  } catch (error) {
    logger.error('Erro ao buscar companhias aéreas', { message: error.message });
    // Tentar fallback local
    try {
      const fallback = require('./config/airlines-fallback.json');
      const list = (q && q.trim()) ? fallback.filter(c => 
        (c.name && c.name.toLowerCase().includes(q.toLowerCase())) || 
        (c.code && c.code.toLowerCase().includes(q.toLowerCase())) || 
        (c.country_name && c.country_name.toLowerCase().includes(q.toLowerCase())) || 
        (c.id && c.id.toString().includes(q))
      ) : fallback;
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

app.get('/api/config-info', (req, res) => {
  try {
    const { apiConfig } = require('./config/api');
    return res.json(envelope(true, {
      url: apiConfig.baseURL,
      token: apiConfig.apiKey,
      maritimoEndpoint: process.env.MARITIMO_PUT_ENDPOINT || '/agent_destination/maritimo',
      aereoEndpoint: process.env.AEREO_PUT_ENDPOINT || '/agent_destination/aereo'
    }, [], []));
  } catch (error) {
    logger.error('Erro ao ler apiConfig', { error: error.message });
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
