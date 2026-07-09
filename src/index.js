require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const logger = require('./config/logger');
const maritimoApiService = require('./services/maritimoApiService');
const aereoApiService = require('./services/aereoApiService');
const db = require('./config/db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

const app = express();
const port = parseInt(process.env.PORT, 10) || 3000;

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ limit: '15mb', extended: false }));

const JWT_SECRET = process.env.JWT_SECRET || 'green-shipping-super-secret-key';

// Middleware de Autenticação JWT para API
function authMiddleware(req, res, next) {
  if (req.path.startsWith('/auth/')) {
    return next();
  }
  
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({
      success: false,
      data: {},
      errors: ['Acesso negado. Token não fornecido.'],
      warnings: []
    });
  }
  
  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      data: {},
      errors: ['Token inválido ou expirado.'],
      warnings: []
    });
  }
}

app.use('/api', authMiddleware);

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

// Helper: Verifica se uma referência de cliente já existe no histórico com status sucesso ou manual
async function verificarReferenciaExistente(refCliente) {
  try {
    const res = await db.query(
      'SELECT 1 FROM processos WHERE TRIM(referencia_cliente) = $1 AND status IN ($2, $3) LIMIT 1',
      [refCliente.trim(), 'sucesso', 'registro_manual']
    );
    return res.rowCount > 0;
  } catch (err) {
    logger.error('Erro ao verificar referencia existente no banco', { error: err.message });
  }
  return false;
}

// Função auxiliar para salvar o histórico de envio
async function salvarHistorico(tipo, payload, status, updateId = null, operacao = null, usuario = 'Admin') {
  try {
    const dataAtual = new Date();
    const opFinal = operacao || (status === 'registro_manual' ? 'Registro Manual' : (updateId ? 'Atualização' : 'Novo Envio'));
    const isProcessoOp = opFinal === 'Novo Envio' || opFinal === 'Atualização' || opFinal === 'Registro Manual';
    
    // Inserir log de auditoria na tabela historico_logs
    await db.query(
      `INSERT INTO historico_logs (status, operacao, usuario, referencia_cliente, numero_processo, tipo, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        status, 
        opFinal, 
        usuario, 
        payload?.referenciaCliente || null, 
        payload?.numeroProcesso || null, 
        tipo, 
        payload
      ]
    );

    // Se for uma operação principal de processo com sucesso, atualizamos a tabela processos
    if (isProcessoOp && (status === 'sucesso' || status === 'registro_manual')) {
      const processId = updateId || (tipo + '-' + Date.now() + Math.random().toString(36).substring(2, 7));
      
      await db.query(
        `INSERT INTO processos (id, tipo, numero_processo, referencia_cliente, status, data_hora_envio, operacao, usuario, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (referencia_cliente)
         DO UPDATE SET
           id = EXCLUDED.id,
           numero_processo = EXCLUDED.numero_processo,
           status = EXCLUDED.status,
           data_hora_envio = EXCLUDED.data_hora_envio,
           operacao = EXCLUDED.operacao,
           usuario = EXCLUDED.usuario,
           payload = EXCLUDED.payload`,
        [
          processId, 
          tipo, 
          payload.numeroProcesso || null, 
          payload.referenciaCliente, 
          status, 
          dataAtual, 
          opFinal, 
          usuario, 
          payload
        ]
      );
    }
    
    logger.info('Histórico salvo no banco de dados', { tipo, status, operacao: opFinal });
  } catch (error) {
    logger.error('Falha ao salvar histórico no banco', { error: error.message });
  }
}

app.post('/api/maritimo/put', async (req, res) => {
  const payload = req.body;
  const updateId = req.headers['x-update-process-id'] || null;
  logger.info('Recebido formulário Marítimo', { bodyKeys: Object.keys(payload), updateId });

  // Se for nova inclusão, validar duplicidade da Referência do Cliente
  if (!updateId && payload.referenciaCliente) {
    const existe = await verificarReferenciaExistente(payload.referenciaCliente);
    if (existe) {
      return res.status(400).json(envelope(false, {}, [`A Referência de Cliente "${payload.referenciaCliente}" já existe no histórico com status Sucesso ou Manual.`]));
    }
  }

  try {
    const result = await maritimoApiService.sendMaritimoPut(payload);
    const usuario = req.user ? req.user.nome : 'Admin';
    await salvarHistorico('maritimo', payload, 'sucesso', updateId, null, usuario);
    return res.status(result.statusCode || 200).json(envelope(true, result.data || {}, [], []));
  } catch (error) {
    const statusCode = error.response?.status || 500;
    const errorData = error.response?.data || error.message;

    logger.error('Falha no PUT Marítimo', { statusCode, error: errorData });
    const usuario = req.user ? req.user.nome : 'Admin';
    await salvarHistorico('maritimo', payload, 'erro', updateId, null, usuario);
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
  const updateId = req.headers['x-update-process-id'] || null;
  logger.info('Recebido formulário Aéreo', { bodyKeys: Object.keys(payload), updateId });

  // Se for nova inclusão, validar duplicidade da Referência do Cliente
  if (!updateId && payload.referenciaCliente) {
    const existe = await verificarReferenciaExistente(payload.referenciaCliente);
    if (existe) {
      return res.status(400).json(envelope(false, {}, [`A Referência de Cliente "${payload.referenciaCliente}" já existe no histórico com status Sucesso ou Manual.`]));
    }
  }

  try {
    const result = await aereoApiService.sendAereoPut(payload);
    const usuario = req.user ? req.user.nome : 'Admin';
    await salvarHistorico('aereo', payload, 'sucesso', updateId, null, usuario);
    return res.status(result.statusCode || 200).json(envelope(true, result.data || {}, [], []));
  } catch (error) {
    const statusCode = error.response?.status || 500;
    const errorData = error.response?.data || error.message;

    logger.error('Falha no PUT Aéreo', { statusCode, error: errorData });
    const usuario = req.user ? req.user.nome : 'Admin';
    await salvarHistorico('aereo', payload, 'erro', updateId, null, usuario);
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

  logger.info('Buscando histórico do banco', { tipo, processo, data });

  try {
    let sql = `SELECT id, TO_CHAR(data_hora_envio, 'YYYY-MM-DD HH24:MI:SS') as "dataHoraEnvio", status, operacao, usuario, payload 
               FROM historico_logs 
               WHERE tipo = $1`;
    const params = [tipo];

    if (processo && processo.trim()) {
      params.push(`%${processo.toLowerCase().trim()}%`);
      sql += ` AND (LOWER(numero_processo) LIKE $${params.length} OR LOWER(referencia_cliente) LIKE $${params.length})`;
    }
    if (data && data.trim()) {
      params.push(`${data.trim()}%`);
      sql += ` AND TO_CHAR(data_hora_envio, 'YYYY-MM-DD') LIKE $${params.length}`;
    }

    sql += ' ORDER BY data_hora_envio DESC';

    const dbRes = await db.query(sql, params);
    
    // Formatar os registros para serem compatíveis com o front
    const registros = dbRes.rows.map(r => ({
      id: String(r.id),
      dataHoraEnvio: r.dataHoraEnvio,
      status: r.status,
      operacao: r.operacao,
      usuario: r.usuario,
      payload: r.payload,
      anexos: [],
      followUps: [],
      despesas: []
    }));

    return res.json(envelope(true, registros, [], []));
  } catch (error) {
    logger.error('Erro ao buscar histórico no banco', { error: error.message });
    return res.status(500).json(envelope(false, {}, [String(error.message)]));
  }
});

// =======================
// GESTÃO DE PROCESSOS ENDPOINTS
// =======================

// 1. Listar histórico unificado (Aéreo e Marítimo)
app.get('/api/processos/unificados', async (req, res) => {
  try {
    const query = `
      SELECT 
        p.id, 
        p.tipo, 
        TO_CHAR(p.data_hora_envio, 'YYYY-MM-DD HH24:MI:SS') as "dataHoraEnvioUTC", 
        p.status, 
        p.operacao, 
        p.usuario, 
        p.numero_processo as "numeroProcesso", 
        p.referencia_cliente as "referenciaCliente", 
        p.payload,
        COALESCE((
          SELECT json_agg(json_build_object(
            'id', a.id,
            'nome', a.nome,
            'categoria', a.categoria_anexo,
            'categoriaNome', a.categoria_nome,
            'dataUpload', TO_CHAR(a.data_upload, 'YYYY-MM-DD HH24:MI:SS'),
            'usuario', a.usuario
          )) FROM anexos a WHERE a.processo_id = p.id
        ), '[]'::json) as "anexosList",
        COALESCE((
          SELECT json_agg(json_build_object(
            'id', f.id,
            'descricao', f.descricao,
            'data', TO_CHAR(f.data_cadastro, 'YYYY-MM-DD HH24:MI:SS'),
            'usuario', f.usuario
          )) FROM follow_ups f WHERE f.processo_id = p.id
        ), '[]'::json) as "followUpsList",
        COALESCE((
          SELECT json_agg(json_build_object(
            'id', d.id,
            'categoriaId', d.categoria_id,
            'categoriaNome', d.categoria_nome,
            'valor', d.valor,
            'moeda', d.moeda,
            'dataCadastro', TO_CHAR(d.data_cadastro, 'YYYY-MM-DD HH24:MI:SS'),
            'usuario', d.usuario,
            'datiIntegrado', d.dati_integrado,
            'datiErro', d.dati_erro
          )) FROM despesas d WHERE d.processo_id = p.id
        ), '[]'::json) as "despesasList"
      FROM processos p
      ORDER BY p.data_hora_envio DESC
    `;
    
    const dbRes = await db.query(query);

    const resultados = dbRes.rows.map(p => ({
      id: p.id,
      tipo: p.tipo,
      dataHoraEnvio: p.dataHoraEnvioUTC || '',
      status: p.status,
      operacao: p.operacao,
      usuario: p.usuario,
      numeroProcesso: p.numeroProcesso || '',
      referenciaCliente: p.referenciaCliente || '',
      payload: p.payload,
      anexos: p.anexosList || [],
      followUps: p.followUpsList || [],
      despesas: p.despesasList || []
    }));

    return res.json(envelope(true, resultados, [], []));
  } catch (error) {
    logger.error('Erro ao buscar processos unificados do banco', { error: error.message });
    return res.status(500).json(envelope(false, {}, [error.message]));
  }
});


// 2. Adicionar processo manual no histórico
app.post('/api/processos/manual', async (req, res) => {
  const { tipo, referenciaCliente, numeroProcesso } = req.body;
  if (!tipo || !referenciaCliente || !numeroProcesso) {
    return res.status(400).json(envelope(false, {}, ['Campos obrigatórios ausentes: tipo, referenciaCliente, numeroProcesso']));
  }
  if (tipo !== 'maritimo' && tipo !== 'aereo') {
    return res.status(400).json(envelope(false, {}, ['Tipo inválido. Deve ser maritimo ou aereo.']));
  }
  
  try {
    const existe = await verificarReferenciaExistente(referenciaCliente);
    if (existe) {
      return res.status(400).json(envelope(false, {}, [`A Referência de Cliente "${referenciaCliente}" já está cadastrada no painel.`]));
    }

    const payload = {
      numeroProcesso,
      referenciaCliente
    };
    const usuario = req.user ? req.user.nome : 'Admin';
    await salvarHistorico(tipo, payload, 'registro_manual', null, null, usuario);
    return res.json(envelope(true, { message: 'Processo cadastrado manualmente no painel local!' }, [], []));
  } catch (error) {
    logger.error('Erro ao salvar processo manual', { error: error.message });
    return res.status(500).json(envelope(false, {}, [error.message]));
  }
});

// 3. Cadastrar anexo na Dati
app.post('/api/processos/anexos', async (req, res) => {
  const { idProcesso, referenciaCliente, nome, base64, categoriaAnexo } = req.body;
  if (!referenciaCliente || !nome || !base64 || !categoriaAnexo) {
    return res.status(400).json(envelope(false, {}, ['Campos obrigatórios ausentes: referenciaCliente, nome, base64, categoriaAnexo']));
  }
  
  try {
    const { putApiClient } = require('./config/api');
    
    // Encaminha para a Dati
    const datiPayload = {
      referenciaCliente,
      base64,
      nomeAnexo: nome,
      categoriaAnexo: parseInt(categoriaAnexo, 10)
    };
    
    logger.info('Enviando anexo para a API Dati', { referenciaCliente, nome, categoriaAnexo });
    const response = await putApiClient.post('/agent_destination/attachments', datiPayload);
    
    if (response.data && response.data.success !== false) {
      const codigoAnexo = response.data.codigoAnexo || Date.now();
      
      // Salvar no banco relacional
      try {
        const usuario = req.user ? req.user.nome : 'Admin';
        await db.query(
          `INSERT INTO anexos (id, processo_id, nome, categoria_anexo, categoria_nome, data_upload, usuario)
           VALUES ($1, (SELECT id FROM processos WHERE referencia_cliente = $2 LIMIT 1), $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO UPDATE SET
             nome = EXCLUDED.nome,
             categoria_anexo = EXCLUDED.categoria_anexo,
             categoria_nome = EXCLUDED.categoria_nome,
             data_upload = EXCLUDED.data_upload,
             usuario = EXCLUDED.usuario`,
          [
            String(codigoAnexo),
            referenciaCliente,
            nome,
            categoriaAnexo,
            response.data.data?.categoriaAnexo || `${categoriaAnexo} - Anexo`,
            new Date(),
            usuario
          ]
        );
      } catch (errDb) {
        logger.error('Erro ao salvar anexo no banco de dados', { error: errDb.message });
      }

      // Salvar entrada de log no histórico
      try {
        const sizeInBytes = Buffer.from(base64, 'base64').length;
        let sizeStr = sizeInBytes + ' B';
        if (sizeInBytes > 1024) sizeStr = (sizeInBytes / 1024).toFixed(1) + ' KB';
        if (sizeInBytes > 1024 * 1024) sizeStr = (sizeInBytes / (1024 * 1024)).toFixed(1) + ' MB';

        const tipoProcesso = idProcesso && idProcesso.startsWith('aereo-') ? 'aereo' : 'maritimo';
        const usuario = req.user ? req.user.nome : 'Admin';
        await salvarHistorico(tipoProcesso, {
          referenciaCliente,
          nomeAnexo: nome,
          tamanhoAnexo: sizeStr,
          categoria: response.data.data?.categoriaAnexo || `${categoriaAnexo} - Anexo`
        }, 'sucesso', null, 'Inclusão de Anexo', usuario);
      } catch (errLog) {
        logger.error('Erro ao salvar log de inclusão de anexo no histórico', { error: errLog.message });
      }
      
      return res.json(envelope(true, response.data, [], []));
    } else {
      const errors = response.data?.errors || [response.data?.message || 'Erro desconhecido na Dati'];
      return res.status(422).json(envelope(false, {}, errors, []));
    }
  } catch (error) {
    const statusCode = error.response?.status || 500;
    const errorData = error.response?.data || error.message;
    logger.error('Erro ao enviar anexo para Dati', { statusCode, error: errorData });
    const errors = [];
    if (errorData && typeof errorData === 'object') {
      if (errorData.errors) errors.push(...errorData.errors);
      else if (errorData.message) errors.push(errorData.message);
      else errors.push(JSON.stringify(errorData));
    } else {
      errors.push(String(errorData));
    }
    return res.status(statusCode).json(envelope(false, {}, errors));
  }
});

// 4. Deletar anexo na Dati
app.delete('/api/processos/anexos/:id', async (req, res) => {
  const { id } = req.params;
  const { idProcesso, referenciaCliente } = req.query;
  
  try {
    const { putApiClient } = require('./config/api');
    
    logger.info('Solicitando exclusão de anexo na Dati', { id, referenciaCliente });
    const response = await putApiClient.delete(`/agent_destination/attachments/${id}`, {
      data: {
        referenciaCliente
      }
    });
    
    if (response.data && response.data.success !== false) {
      // Remover do banco relacional
      try {
        await db.query('DELETE FROM anexos WHERE id = $1', [String(id)]);
      } catch (errDb) {
        logger.error('Erro ao deletar anexo no banco de dados', { error: errDb.message });
      }

      // Salvar entrada de log no histórico
      try {
        const tipoProcesso = idProcesso && idProcesso.startsWith('aereo-') ? 'aereo' : 'maritimo';
        const usuario = req.user ? req.user.nome : 'Admin';
        await salvarHistorico(tipoProcesso, {
          referenciaCliente,
          anexoId: id
        }, 'sucesso', null, 'Exclusão de Anexo', usuario);
      } catch (errLog) {
        logger.error('Erro ao salvar log de exclusão de anexo no histórico', { error: errLog.message });
      }

      return res.json(envelope(true, { message: 'Anexo deletado com sucesso!' }, [], []));
    } else {
      const errors = response.data?.errors || [response.data?.message || 'Erro ao deletar anexo na Dati'];
      return res.status(422).json(envelope(false, {}, errors, []));
    }
  } catch (error) {
    const statusCode = error.response?.status || 500;
    const errorData = error.response?.data || error.message;
    logger.error('Erro ao deletar anexo na Dati', { statusCode, error: errorData });
    return res.status(statusCode).json(envelope(false, {}, [String(errorData)]));
  }
});

// 5. Adicionar Follow Up na Dati
app.post('/api/processos/follow-up', async (req, res) => {
  const { idProcesso, referenciaCliente, descricao } = req.body;
  if (!referenciaCliente || !descricao) {
    return res.status(400).json(envelope(false, {}, ['Campos obrigatórios ausentes: referenciaCliente, descricao']));
  }
  
  try {
    const { putApiClient } = require('./config/api');
    
    const pad = (num) => String(num).padStart(2, '0');
    const dataAtual = new Date();
    const dataHoraStr = `${dataAtual.getFullYear()}-${pad(dataAtual.getMonth() + 1)}-${pad(dataAtual.getDate())} ${pad(dataAtual.getHours())}:${pad(dataAtual.getMinutes())}`;

    const datiPayload = {
      referenciaCliente,
      mensagem: descricao,
      data: dataHoraStr
    };
    
    logger.info('Cadastrando Follow Up na Dati', { referenciaCliente });
    const response = await putApiClient.post('/agent_destination/follow-up', datiPayload);
    
    if (response.data && response.data.success !== false) {
      // Salvar no banco relacional
      try {
        const usuario = req.user ? req.user.nome : 'Admin';
        await db.query(
          `INSERT INTO follow_ups (processo_id, descricao, data_cadastro, usuario)
           VALUES ((SELECT id FROM processos WHERE referencia_cliente = $1 LIMIT 1), $2, $3, $4)`,
          [referenciaCliente, descricao, new Date(), usuario]
        );
      } catch (errDb) {
        logger.error('Erro ao salvar follow-up no banco de dados', { error: errDb.message });
      }

      // Salvar entrada de log no histórico
      try {
        const tipoProcesso = idProcesso && idProcesso.startsWith('aereo-') ? 'aereo' : 'maritimo';
        const usuario = req.user ? req.user.nome : 'Admin';
        await salvarHistorico(tipoProcesso, {
          referenciaCliente,
          mensagem: descricao
        }, 'sucesso', null, 'Lançamento de Follow Up', usuario);
      } catch (errLog) {
        logger.error('Erro ao salvar log de follow-up no histórico', { error: errLog.message });
      }
      
      return res.json(envelope(true, response.data, [], []));
    } else {
      const errors = response.data?.errors || [response.data?.message || 'Erro ao cadastrar follow-up na Dati'];
      return res.status(422).json(envelope(false, {}, errors, []));
    }
  } catch (error) {
    const statusCode = error.response?.status || 500;
    const errorData = error.response?.data || error.message;
    logger.error('Erro ao cadastrar follow-up na Dati', { statusCode, error: errorData });
    const errors = [];
    if (errorData && typeof errorData === 'object') {
      if (errorData.errors) errors.push(...errorData.errors);
      else if (errorData.message) errors.push(errorData.message);
      else errors.push(JSON.stringify(errorData));
    } else {
      errors.push(String(errorData));
    }
    return res.status(statusCode).json(envelope(false, {}, errors));
  }
});

// 6. Buscar categorias de despesas da Dati
app.get('/api/processos/despesas/categorias', async (req, res) => {
  const { referenciaCliente } = req.query;
  const fallbackCategorias = [
    { id: 1, name: 'Frete Internacional' },
    { id: 2, name: 'Taxa de B/L' },
    { id: 3, name: 'Armazenagem' },
    { id: 4, name: 'Capatazia (THC)' },
    { id: 5, name: 'Imposto de Importação (II)' },
    { id: 6, name: 'IPI / PIS / COFINS' },
    { id: 7, name: 'Honorários de Despachante' },
    { id: 8, name: 'Seguro de Carga' },
    { id: 9, name: 'Transporte Rodoviário' },
    { id: 10, name: 'Outros' }
  ];
  
  try {
    const { putApiClient } = require('./config/api');
    
    // Constrói a URL com base na referência do cliente recebida
    const refParam = referenciaCliente ? `?referenciaCliente=${encodeURIComponent(referenciaCliente)}` : '';
    const endpoint = `/agent_destination/sas_transactions/categories${refParam}`;
    
    logger.info('Buscando categorias de despesas na Dati', { endpoint });
    const response = await putApiClient.get(endpoint);
    if (response.data && response.data.success !== false) {
      // Retorna a lista de categorias original da Dati
      const lista = response.data.data || response.data || fallbackCategorias;
      return res.json(envelope(true, lista, [], []));
    }
    return res.json(envelope(true, fallbackCategorias, [], ['fallback']));
  } catch (error) {
    logger.info('Despesas categorias indisponível na API Dati, usando fallback local', { msg: error.message });
    return res.json(envelope(true, fallbackCategorias, [], ['fallback']));
  }
});

// 7. Cadastrar despesa na Dati
app.post('/api/processos/despesas', async (req, res) => {
  const { idProcesso, referenciaCliente, categoriaId, categoriaNome, valor, moeda } = req.body;
  if (!referenciaCliente || !categoriaId || !valor || !moeda) {
    return res.status(400).json(envelope(false, {}, ['Campos obrigatórios ausentes: referenciaCliente, categoriaId, valor, moeda']));
  }
  
  try {
    const { putApiClient } = require('./config/api');
    const endpoint = process.env.EXPENSES_ENDPOINT || '/agent_destination/sas_transactions';
    
    const datiPayload = {
      referenciaCliente,
      statusPagamento: 'PENDENTE',
      transactions: [
        {
          categoriaDespesa: parseInt(categoriaId, 10),
          moeda: String(moeda),
          taxaMoeda: 1.0,
          valor: parseFloat(valor)
        }
      ]
    };
    
    logger.info('Cadastrando despesa na Dati', { referenciaCliente, categoriaId, valor, moeda });
    let datiResponse = null;
    let datiIntegrado = true;
    let datiErroMsg = null;
    
    try {
      const response = await putApiClient.post(endpoint, datiPayload);
      datiResponse = response.data;
      const success = Array.isArray(response.data) || (response.data && response.data.success !== false);
      if (!success) {
        const errors = response.data?.errors || [response.data?.message || 'Erro ao cadastrar despesa'];
        datiErroMsg = errors.join(' ');
        datiIntegrado = false;
      }
    } catch (apiError) {
      const isSandboxMock = apiError.response?.status === 403 || apiError.response?.status === 404;
      const errorData = apiError.response?.data;
      datiErroMsg = errorData?.message || (errorData?.errors && errorData.errors.join(' ')) || apiError.message || 'Erro de conexão com a Dati';
      
      // Se for 403/404 da Dati Sandbox, é porque a rota do endpoint não existe lá. Tratamos como erro de integração sem travar local.
      datiIntegrado = false;
    }
    
    // 1. Sempre salvar no banco relacional local
    try {
      const usuario = req.user ? req.user.nome : 'Admin';
      await db.query(
        `INSERT INTO despesas (processo_id, categoria_id, categoria_nome, valor, moeda, data_cadastro, usuario, dati_integrado, dati_erro)
         VALUES ((SELECT id FROM processos WHERE referencia_cliente = $1 LIMIT 1), $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          referenciaCliente, 
          categoriaId, 
          categoriaNome || `Categoria ${categoriaId}`, 
          parseFloat(valor), 
          String(moeda), 
          new Date(),
          usuario,
          datiIntegrado,
          datiErroMsg
        ]
      );
    } catch (errDb) {
      logger.error('Erro ao salvar despesa no banco de dados', { error: errDb.message });
    }

    // 2. Salvar entrada de log no histórico
    try {
      const tipoProcesso = idProcesso && idProcesso.startsWith('aereo-') ? 'aereo' : 'maritimo';
      
      // Mapear código da moeda para exibição
      let moedaNick = 'USD';
      const moedaVal = parseInt(moeda, 10);
      if (moedaVal === 1 || moedaVal === 2 || moedaVal === 790) moedaNick = 'BRL';
      else if (moedaVal === 220) moedaNick = 'USD';
      else if (moedaVal === 3 || moedaVal === 978) moedaNick = 'EUR';

      const usuario = req.user ? req.user.nome : 'Admin';
      const logOp = datiIntegrado ? 'Lançamento de Despesa' : 'Lançamento de Despesa (Falha Integração Dati)';
      
      await salvarHistorico(tipoProcesso, {
        referenciaCliente,
        categoriaId,
        categoriaNome: categoriaNome || `Categoria ${categoriaId}`,
        valor: parseFloat(valor),
        moeda: moedaNick,
        datiErro: datiErroMsg
      }, 'sucesso', null, logOp, usuario);
    } catch (errLog) {
      logger.error('Erro ao salvar log de despesa no histórico', { error: errLog.message });
    }
    
    // 3. Retornar resposta
    const warnings = datiIntegrado ? [] : [datiErroMsg || 'A integração com a Dati falhou'];
    return res.json(envelope(true, datiResponse || { message: 'Despesa cadastrada localmente.' }, [], warnings));
  } catch (error) {
    logger.error('Erro geral ao processar cadastro de despesa', { error: error.message });
    return res.status(500).json(envelope(false, {}, [error.message], []));
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
    let limit = q ? 20 : 50;
    if (req.query.limit === 'all') {
      limit = portos.length;
    }
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
    let limit = q ? 20 : 50;
    if (req.query.limit === 'all') {
      limit = aeroportos.length;
    }
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
    let limit = q ? 20 : 50;
    if (req.query.limit === 'all') {
      limit = companies.length;
    }
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
    let limit = q ? 20 : 50;
    if (req.query.limit === 'all') {
      limit = airlines.length;
    }
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
    let limit = q ? 20 : 50;
    if (req.query.limit === 'all') {
      limit = vessels.length;
    }
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
    let limit = q ? 20 : 50;
    if (req.query.limit === 'all') {
      limit = warehouses.length;
    }
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
    const { putApiConfig } = require('./config/api');
    return res.json(envelope(true, {
      url: putApiConfig.baseURL,
      token: putApiConfig.apiKey,
      maritimoEndpoint: process.env.MARITIMO_PUT_ENDPOINT || '/agent_destination/maritimo',
      aereoEndpoint: process.env.AEREO_PUT_ENDPOINT || '/agent_destination/aereo'
    }, [], []));
  } catch (error) {
    logger.error('Erro ao ler putApiConfig', { error: error.message });
    return res.status(500).json(envelope(false, {}, [String(error.message)]));
  }
});

// =======================
// AUTHENTICATION ENDPOINTS
// =======================

async function enviarEmail(destinatario, assunto, textoHtml, textoSimples) {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT, 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    logger.warn('Envio de e-mail simulado (dados de SMTP ausentes no .env)', { destinatario, assunto });
    console.log('\n--- SIMULADOR DE E-MAIL ---');
    console.log(`Para: ${destinatario}`);
    console.log(`Assunto: ${assunto}`);
    console.log(`Mensagem:\n${textoSimples}`);
    console.log('---------------------------\n');
    return true;
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: {
        user,
        pass
      }
    });

    await transporter.sendMail({
      from: `"Green Shipping" <${user}>`,
      to: destinatario,
      subject: assunto,
      text: textoSimples,
      html: textoHtml
    });
    
    logger.info('E-mail enviado com sucesso', { destinatario, assunto });
    return true;
  } catch (err) {
    logger.error('Erro ao enviar e-mail', { error: err.message, destinatario });
    return false;
  }
}

// 1. Rota de Login
app.post('/api/auth/login', async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) {
    return res.status(400).json(envelope(false, {}, ['E-mail e senha são obrigatórios.']));
  }

  try {
    const userRes = await db.query(
      `SELECT id, nome, email, senha, ativo, papel_id, tentativas_erradas, bloqueado_ate, bloqueios_consecutivos 
       FROM usuarios 
       WHERE LOWER(email) = LOWER($1) 
          OR LOWER(nome) = LOWER($1) 
          OR LOWER(SPLIT_PART(nome, ' ', 1)) = LOWER($1)
          OR (LOWER(nome) = 'administrador' AND LOWER($1) = 'admin') 
       LIMIT 1`,
      [email.trim()]
    );

    if (userRes.rows.length === 0) {
      return res.status(401).json(envelope(false, {}, ['E-mail ou senha incorretos.']));
    }

    const user = userRes.rows[0];

    if (!user.ativo) {
      return res.status(403).json(envelope(false, {}, ['Esta conta está inativa. Contate o suporte.']));
    }

    // Verificar bloqueio ativo
    if (user.bloqueado_ate) {
      const lockDate = new Date(user.bloqueado_ate);
      const now = new Date();
      if (lockDate > now) {
        const diff = lockDate - now;
        const minutos = Math.ceil(diff / (60 * 1000));
        return res.status(403).json(envelope(false, {}, [`Sua conta está bloqueada devido a tentativas incorretas. Tente novamente em ${minutos} minuto(s).`]));
      }
    }

    // Verificar senha
    const isSenhaValida = bcrypt.compareSync(senha, user.senha);

    if (!isSenhaValida) {
      const novasTentativas = user.tentativas_erradas + 1;
      
      if (novasTentativas >= 3) {
        const novosBloqueios = user.bloqueios_consecutivos + 1;
        const minutosBloqueio = 3 * Math.pow(3, novosBloqueios - 1);
        const bloqueadoAte = new Date(Date.now() + minutosBloqueio * 60 * 1000);

        await db.query(
          `UPDATE usuarios 
           SET tentativas_erradas = 0, bloqueado_ate = $1, bloqueios_consecutivos = $2 
           WHERE id = $3`,
          [bloqueadoAte, novosBloqueios, user.id]
        );

        // Disparar e-mail de alerta
        const subject = 'Alerta de Segurança - Tentativas de Acesso Excessivas';
        const textHtml = `
          <div style="font-family: sans-serif; padding: 20px; color: #334155; line-height: 1.6;">
            <h2 style="color: #ef4444; margin-top: 0;">Alerta de Segurança</h2>
            <p>Olá, <strong>${user.nome}</strong>.</p>
            <p>Detectamos <strong>3 tentativas consecutivas de login incorretas</strong> na sua conta em <strong>${new Date().toLocaleString('pt-BR')}</strong>.</p>
            <p>Por medida de segurança, sua conta foi temporariamente bloqueada por <strong>${minutosBloqueio} minutos</strong>.</p>
            <p>Se você esqueceu sua senha, você pode usar a opção de redefinição de senha no site.</p>
            <p style="font-size: 13px; color: #64748b; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 15px;">Se você não reconhece estas tentativas, por favor entre em contato com o administrador imediatamente.</p>
          </div>
        `;
        const textSimple = `Olá, ${user.nome}.\n\nDetectamos 3 tentativas consecutivas de login incorretas na sua conta em ${new Date().toLocaleString('pt-BR')}.\n\nPor medida de segurança, sua conta foi temporariamente bloqueada por ${minutosBloqueio} minutos.\n\nSe você não reconhece estas tentativas, por favor entre em contato com o administrador imediatamente.`;
        
        enviarEmail(user.email, subject, textHtml, textSimple);

        return res.status(403).json(envelope(false, {}, [`Sua conta foi bloqueada por ${minutosBloqueio} minutos devido a 3 erros seguidos.`]));
      } else {
        await db.query(
          `UPDATE usuarios SET tentativas_erradas = $1 WHERE id = $2`,
          [novasTentativas, user.id]
        );
        return res.status(401).json(envelope(false, {}, [`E-mail ou senha incorretos. Tentativa ${novasTentativas} de 3 antes do bloqueio.`]));
      }
    }

    // Login com sucesso, zerar bloqueios
    await db.query(
      `UPDATE usuarios 
       SET tentativas_erradas = 0, bloqueado_ate = NULL, bloqueios_consecutivos = 0 
       WHERE id = $1`,
      [user.id]
    );

    const token = jwt.sign(
      { id: user.id, nome: user.nome, email: user.email, papelId: user.papel_id },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    return res.json(envelope(true, {
      token,
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        papelId: user.papel_id
      }
    }, [], []));

  } catch (error) {
    logger.error('Erro na rota de login', { 
      error: error.message || String(error), 
      stack: error.stack, 
      details: JSON.stringify(error) 
    });
    return res.status(500).json(envelope(false, {}, ['Erro ao processar login.']));
  }
});

// 2. Rota de Esqueci a Senha (Forgot Password)
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json(envelope(false, {}, ['E-mail é obrigatório.']));
  }

  try {
    const userRes = await db.query(
      `SELECT id, nome, email, ativo FROM usuarios WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email.trim()]
    );

    // Proteção de Enumeração de Usuários (sempre retornar sucesso, mas enviar e-mail somente se existir)
    if (userRes.rows.length === 0 || !userRes.rows[0].ativo) {
      return res.json(envelope(true, { message: 'Se o e-mail estiver cadastrado, um código foi enviado para recuperação.' }, [], []));
    }

    const user = userRes.rows[0];
    const codigo = Math.floor(100000 + Math.random() * 900000).toString(); // Código numérico de 6 dígitos
    const expiraEm = new Date(Date.now() + 15 * 60 * 1000); // Expira em 15 minutos

    await db.query(
      `INSERT INTO recuperacao_senha (email, codigo, expira_em) VALUES ($1, $2, $3)`,
      [user.email, codigo, expiraEm]
    );

    const subject = 'Código de Recuperação de Senha - Green Shipping';
    const textHtml = `
      <div style="font-family: sans-serif; padding: 20px; color: #334155; line-height: 1.6;">
        <h2 style="color: #6366f1; margin-top: 0;">Recuperação de Senha</h2>
        <p>Olá, <strong>${user.nome}</strong>.</p>
        <p>Recebemos uma solicitação para redefinir a senha da sua conta no Green Shipping.</p>
        <p>Use o código de verificação de 6 dígitos abaixo para prosseguir com a redefinição (este código expira em 15 minutos):</p>
        <div style="font-size: 32px; font-weight: bold; color: #1e1b4b; background: #e0e7ff; padding: 15px; border-radius: 8px; text-align: center; letter-spacing: 5px; margin: 20px 0; max-width: 250px; border: 1px solid #c7d2fe;">
          ${codigo}
        </div>
        <p>Se você não solicitou esta alteração, por favor ignore este e-mail.</p>
      </div>
    `;
    const textSimple = `Olá, ${user.nome}.\n\nRecebemos uma solicitação para redefinir a senha da sua conta no Green Shipping.\n\nUse o código de verificação de 6 dígitos abaixo para redefinir sua senha (válido por 15 minutos):\n\n${codigo}\n\nSe você não solicitou esta alteração, por favor ignore este e-mail.`;

    await enviarEmail(user.email, subject, textHtml, textSimple);

    return res.json(envelope(true, { message: 'Código de recuperação enviado por e-mail com sucesso.' }, [], []));

  } catch (error) {
    logger.error('Erro na rota de recuperar senha', { error: error.message });
    return res.status(500).json(envelope(false, {}, ['Erro ao solicitar recuperação de senha.']));
  }
});

// 3. Rota de Redefinir a Senha (Reset Password)
app.post('/api/auth/reset-password', async (req, res) => {
  const { email, codigo, novaSenha } = req.body;
  if (!email || !codigo || !novaSenha) {
    return res.status(400).json(envelope(false, {}, ['Campos obrigatórios: email, codigo, novaSenha.']));
  }

  const senhaLimpa = String(novaSenha).trim();
  if (senhaLimpa.length < 6 || senhaLimpa.length > 15) {
    return res.status(400).json(envelope(false, {}, ['A senha deve conter de 6 a 15 caracteres.']));
  }

  try {
    const codeRes = await db.query(
      `SELECT id, expira_em, usado FROM recuperacao_senha 
       WHERE LOWER(email) = LOWER($1) AND codigo = $2 AND usado = FALSE 
       ORDER BY created_at DESC LIMIT 1`,
      [email.trim(), codigo.trim()]
    );

    if (codeRes.rows.length === 0) {
      return res.status(400).json(envelope(false, {}, ['Código de verificação inválido ou inexistente.']));
    }

    const codeRec = codeRes.rows[0];
    if (new Date(codeRec.expira_em) < new Date()) {
      return res.status(400).json(envelope(false, {}, ['Este código de verificação já expirou.']));
    }

    // Marcar código como usado
    await db.query(
      `UPDATE recuperacao_senha SET usado = TRUE WHERE id = $1`,
      [codeRec.id]
    );

    // Hash da nova senha
    const hash = bcrypt.hashSync(senhaLimpa, 10);

    // Atualizar senha do usuário AND zerar todos os bloqueios e tentativas consecutivas
    await db.query(
      `UPDATE usuarios 
       SET senha = $1, tentativas_erradas = 0, bloqueado_ate = NULL, bloqueios_consecutivos = 0 
       WHERE LOWER(email) = LOWER($2)`,
      [hash, email.trim()]
    );

    return res.json(envelope(true, { message: 'Senha redefinida com sucesso! Bloqueio de conta removido.' }, [], []));

  } catch (error) {
    logger.error('Erro na rota de redefinir senha', { error: error.message });
    return res.status(500).json(envelope(false, {}, ['Erro ao redefinir a senha.']));
  }
});

// 4. Validação rápida de token
app.get('/api/auth/validate-token', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json(envelope(false, {}, ['Token não fornecido.']));
  }
  
  try {
    const verified = jwt.verify(token, JWT_SECRET);
    return res.json(envelope(true, { user: verified }, [], []));
  } catch (err) {
    return res.status(401).json(envelope(false, {}, ['Token inválido ou expirado.']));
  }
});

// Middleware de autorização para Administradores
function adminMiddleware(req, res, next) {
  if (req.user && req.user.papelId === 1) {
    return next();
  }
  return res.status(403).json(envelope(false, {}, ['Acesso negado. Apenas administradores podem acessar esta área.']));
}

// 5. Listar todos os usuários (Admin)
app.get('/api/admin/users', adminMiddleware, async (req, res) => {
  try {
    const dbRes = await db.query(
      `SELECT u.id, u.nome, u.email, u.ativo, u.papel_id as "papelId", p.nome as "papelNome" 
       FROM usuarios u
       LEFT JOIN papeis p ON u.papel_id = p.id
       ORDER BY u.id ASC`
    );
    return res.json(envelope(true, dbRes.rows, [], []));
  } catch (error) {
    logger.error('Erro ao listar usuários (admin)', { error: error.message });
    return res.status(500).json(envelope(false, {}, ['Erro ao obter lista de usuários.']));
  }
});

// 6. Listar papéis (Admin)
app.get('/api/admin/roles', adminMiddleware, async (req, res) => {
  try {
    const dbRes = await db.query(`SELECT id, nome, descricao FROM papeis ORDER BY id ASC`);
    return res.json(envelope(true, dbRes.rows, [], []));
  } catch (error) {
    logger.error('Erro ao listar perfis (admin)', { error: error.message });
    return res.status(500).json(envelope(false, {}, ['Erro ao obter perfis de usuário.']));
  }
});

// 7. Criar usuário (Admin)
app.post('/api/admin/users', adminMiddleware, async (req, res) => {
  const { nome, email, senha, papelId, ativo, enviarLinkSenha } = req.body;
  if (!nome || !email || !papelId) {
    return res.status(400).json(envelope(false, {}, ['Nome, e-mail e papel são obrigatórios.']));
  }

  const linkSenha = enviarLinkSenha === true;

  if (!linkSenha && (!senha || senha.length < 6 || senha.length > 15)) {
    return res.status(400).json(envelope(false, {}, ['A senha deve conter entre 6 e 15 caracteres.']));
  }

  try {
    // Verificar se e-mail já existe
    const existRes = await db.query('SELECT id FROM usuarios WHERE LOWER(email) = LOWER($1)', [email.trim()]);
    if (existRes.rows.length > 0) {
      return res.status(400).json(envelope(false, {}, ['Este endereço de e-mail já está cadastrado.']));
    }

    let hashSenha = '!';
    if (!linkSenha) {
      const salt = bcrypt.genSaltSync(10);
      hashSenha = bcrypt.hashSync(senha, salt);
    }

    await db.query(
      `INSERT INTO usuarios (nome, email, senha, papel_id, ativo) 
       VALUES ($1, $2, $3, $4, $5)`,
      [nome.trim(), email.trim(), hashSenha, parseInt(papelId, 10), ativo !== false]
    );

    // Se escolheu enviar link por e-mail para criar a senha
    if (linkSenha) {
      const codigo = String(Math.floor(100000 + Math.random() * 900000).toString().slice(0, 6));
      const expiraEm = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas

      await db.query(
        `INSERT INTO recuperacao_senha (email, codigo, expira_em) 
         VALUES ($1, $2, $3)`,
        [email.trim(), codigo, expiraEm]
      );

      const subject = 'Ative sua Conta - Green Shipping';
      const textHtml = `
        <div style="font-family: sans-serif; padding: 20px; color: #334155; line-height: 1.6;">
          <h2 style="color: #2d665b; margin-top: 0;">Bem-vindo ao Green Shipping</h2>
          <p>Olá, <strong>${nome}</strong>.</p>
          <p>Sua conta foi criada no Painel de Integração de Processos Dati pelo administrador!</p>
          <p>Para definir sua senha e ativar o seu acesso, use o seguinte código de ativação:</p>
          <div style="background: #f1f5f9; padding: 15px; border-radius: 8px; font-size: 24px; font-weight: bold; letter-spacing: 4px; text-align: center; color: #0f172a; margin: 20px 0;">
            ${codigo}
          </div>
          <p>Acesse a tela de login, clique em <strong>"Esqueceu sua senha?"</strong> (ou use a opção de redefinir senha) informando seu e-mail e o código acima para cadastrar a sua senha pessoal.</p>
          <p style="font-size: 13px; color: #64748b; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 15px;">Este link e código expiram em 24 horas.</p>
        </div>
      `;
      const textSimple = `Olá, ${nome}.\n\nSua conta foi criada no Painel de Integração de Processos Dati!\n\nPara definir sua senha e ativar seu acesso, use o código de ativação: ${codigo}\n\nInsira este código na área de redefinir senha do site.`;
      
      enviarEmail(email.trim(), subject, textHtml, textSimple);
    }

    return res.json(envelope(true, { message: 'Usuário cadastrado com sucesso!' }, [], []));
  } catch (error) {
    logger.error('Erro ao criar usuário (admin)', { error: error.message });
    return res.status(500).json(envelope(false, {}, ['Erro ao cadastrar usuário.']));
  }
});

// 8. Atualizar usuário (Admin)
app.put('/api/admin/users/:id', adminMiddleware, async (req, res) => {
  const { id } = req.params;
  const { nome, email, senha, papelId, ativo } = req.body;

  const targetId = parseInt(id, 10);
  const authUserEmail = req.user ? req.user.email.toLowerCase() : '';
  const specialEmails = ['admin@greenshipping.com', 'luiggi.lechinski@greenshipping.com.br', 'lucianovs.lpl@gmail.com'];

  try {
    // Buscar email do usuário alvo para ver se é admin especial
    const targetUserQuery = await db.query('SELECT email FROM usuarios WHERE id = $1', [targetId]);
    if (targetUserQuery.rows.length > 0) {
      const targetEmail = targetUserQuery.rows[0].email.toLowerCase();
      if (specialEmails.includes(targetEmail) && authUserEmail !== targetEmail) {
        return res.status(403).json(envelope(false, {}, ['Você não tem permissão para alterar este administrador especial.']));
      }
    }

    if (!nome || !email || !papelId) {
      return res.status(400).json(envelope(false, {}, ['Nome, e-mail e papel são obrigatórios.']));
    }

    if (senha && (senha.length < 6 || senha.length > 15)) {
      return res.status(400).json(envelope(false, {}, ['A senha deve conter entre 6 e 15 caracteres.']));
    }

    // Verificar se e-mail já pertence a outro usuário
    const existRes = await db.query(
      'SELECT id FROM usuarios WHERE LOWER(email) = LOWER($1) AND id <> $2',
      [email.trim(), targetId]
    );
    if (existRes.rows.length > 0) {
      return res.status(400).json(envelope(false, {}, ['Este endereço de e-mail já está sendo utilizado por outro usuário.']));
    }

    if (senha) {
      const salt = bcrypt.genSaltSync(10);
      const hashSenha = bcrypt.hashSync(senha, salt);

      await db.query(
        `UPDATE usuarios 
         SET nome = $1, email = $2, senha = $3, papel_id = $4, ativo = $5 
         WHERE id = $6`,
        [nome.trim(), email.trim(), hashSenha, parseInt(papelId, 10), ativo !== false, targetId]
      );
    } else {
      await db.query(
        `UPDATE usuarios 
         SET nome = $1, email = $2, papel_id = $3, ativo = $4 
         WHERE id = $5`,
        [nome.trim(), email.trim(), parseInt(papelId, 10), ativo !== false, targetId]
      );
    }

    return res.json(envelope(true, { message: 'Usuário atualizado com sucesso!' }, [], []));
  } catch (error) {
    logger.error('Erro ao atualizar usuário (admin)', { error: error.message });
    return res.status(500).json(envelope(false, {}, ['Erro ao atualizar usuário.']));
  }
});

// 9. Resetar senha de um usuário e enviar convite por e-mail (Admin)
app.post('/api/admin/users/:id/reset-password', adminMiddleware, async (req, res) => {
  const { id } = req.params;
  const targetId = parseInt(id, 10);
  const authUserEmail = req.user ? req.user.email.toLowerCase() : '';
  const specialEmails = ['admin@greenshipping.com', 'luiggi.lechinski@greenshipping.com.br', 'lucianovs.lpl@gmail.com'];

  try {
    const userRes = await db.query('SELECT nome, email FROM usuarios WHERE id = $1', [targetId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json(envelope(false, {}, ['Usuário não encontrado.']));
    }

    const { nome, email } = userRes.rows[0];
    const targetEmail = email.toLowerCase();

    if (specialEmails.includes(targetEmail) && authUserEmail !== targetEmail) {
      return res.status(403).json(envelope(false, {}, ['Você não tem permissão para resetar a senha deste administrador especial.']));
    }

    // Resetar senha no banco para inativa ('!')
    await db.query('UPDATE usuarios SET senha = $1 WHERE id = $2', ['!', targetId]);

    // Gerar código de recuperação
    const codigo = String(Math.floor(100000 + Math.random() * 900000).toString().slice(0, 6));
    const expiraEm = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 horas de validade

    await db.query(
      `INSERT INTO recuperacao_senha (email, codigo, expira_em) 
       VALUES ($1, $2, $3)`,
      [email, codigo, expiraEm]
    );

    const subject = 'Redefinição de Senha Requerida - Green Shipping';
    const textHtml = `
      <div style="font-family: sans-serif; padding: 20px; color: #334155; line-height: 1.6;">
        <h2 style="color: #b45309; margin-top: 0;">Redefinição de Senha Requerida</h2>
        <p>Olá, <strong>${nome}</strong>.</p>
        <p>O administrador solicitou o **reset da sua senha** de acesso ao Painel Green Shipping.</p>
        <p>Por motivos de segurança, o seu acesso anterior foi temporariamente suspenso até que você cadastre uma nova senha.</p>
        <p>Para cadastrar a sua nova senha de acesso, use o seguinte código de verificação:</p>
        <div style="background: #f1f5f9; padding: 15px; border-radius: 8px; font-size: 24px; font-weight: bold; letter-spacing: 4px; text-align: center; color: #0f172a; margin: 20px 0;">
          ${codigo}
        </div>
        <p>Insira este código na tela de redefinição de senha para criar seu novo acesso.</p>
        <p style="font-size: 13px; color: #64748b; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 15px;">Este código expira em 2 horas.</p>
      </div>
    `;
    const textSimple = `Olá, ${nome}.\n\nO administrador solicitou o reset da sua senha de acesso ao Painel Green Shipping.\n\nPara cadastrar uma nova senha, use o código de verificação: ${codigo}\n\nInsira este código na tela de redefinição do site.`;

    enviarEmail(email, subject, textHtml, textSimple);

    return res.json(envelope(true, { message: 'Senha resetada e e-mail enviado com sucesso!' }, [], []));
  } catch (error) {
    logger.error('Erro ao resetar senha de usuário (admin)', { error: error.message });
    return res.status(500).json(envelope(false, {}, ['Erro ao processar reset de senha.']));
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
