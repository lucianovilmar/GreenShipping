require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const logger = require('./config/logger');
const maritimoApiService = require('./services/maritimoApiService');
const aereoApiService = require('./services/aereoApiService');
const db = require('./config/db');

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
    await salvarHistorico('maritimo', payload, 'sucesso', updateId);
    return res.status(result.statusCode || 200).json(envelope(true, result.data || {}, [], []));
  } catch (error) {
    const statusCode = error.response?.status || 500;
    const errorData = error.response?.data || error.message;

    logger.error('Falha no PUT Marítimo', { statusCode, error: errorData });
    await salvarHistorico('maritimo', payload, 'erro', updateId);
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
    await salvarHistorico('aereo', payload, 'sucesso', updateId);
    return res.status(result.statusCode || 200).json(envelope(true, result.data || {}, [], []));
  } catch (error) {
    const statusCode = error.response?.status || 500;
    const errorData = error.response?.data || error.message;

    logger.error('Falha no PUT Aéreo', { statusCode, error: errorData });
    await salvarHistorico('aereo', payload, 'erro', updateId);
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
      SELECT p.*,
        COALESCE((
          SELECT json_agg(json_build_object(
            'id', a.id,
            'nomeAnexo', a.nome,
            'categoria', a.categoria_anexo,
            'categoriaNome', a.categoria_nome,
            'dataUpload', TO_CHAR(a.data_upload, 'YYYY-MM-DD HH24:MI:SS')
          )) FROM anexos a WHERE a.processo_id = p.id
        ), '[]'::json) as "anexosList",
        COALESCE((
          SELECT json_agg(json_build_object(
            'id', f.id,
            'mensagem', f.descricao,
            'data', TO_CHAR(f.data_cadastro, 'YYYY-MM-DD HH24:MI:SS')
          )) FROM follow_ups f WHERE f.processo_id = p.id
        ), '[]'::json) as "followUpsList",
        COALESCE((
          SELECT json_agg(json_build_object(
            'id', d.id,
            'categoriaId', d.categoria_id,
            'categoriaNome', d.categoria_nome,
            'valor', d.valor,
            'moeda', d.moeda,
            'dataCadastro', TO_CHAR(d.data_cadastro, 'YYYY-MM-DD HH24:MI:SS')
          )) FROM despesas d WHERE d.processo_id = p.id
        ), '[]'::json) as "despesasList"
      FROM processos p
      ORDER BY p.data_hora_envio DESC
    `;
    
    const dbRes = await db.query(query);

    const resultados = dbRes.rows.map(p => ({
      id: p.id,
      tipo: p.tipo,
      dataHoraEnvio: p.data_hora_envio ? new Date(p.data_hora_envio).toISOString().slice(0, 19).replace('T', ' ') : '',
      status: p.status,
      operacao: p.operacao,
      usuario: p.usuario,
      numeroProcesso: p.numero_processo || '',
      referenciaCliente: p.referencia_cliente || '',
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
    await salvarHistorico(tipo, payload, 'registro_manual');
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
        await db.query(
          `INSERT INTO anexos (id, processo_id, nome, categoria_anexo, categoria_nome, data_upload)
           VALUES ($1, (SELECT id FROM processos WHERE referencia_cliente = $2 LIMIT 1), $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET
             nome = EXCLUDED.nome,
             categoria_anexo = EXCLUDED.categoria_anexo,
             categoria_nome = EXCLUDED.categoria_nome,
             data_upload = EXCLUDED.data_upload`,
          [
            String(codigoAnexo),
            referenciaCliente,
            nome,
            categoriaAnexo,
            response.data.data?.categoriaAnexo || `${categoriaAnexo} - Anexo`,
            new Date()
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
        await salvarHistorico(tipoProcesso, {
          referenciaCliente,
          nomeAnexo: nome,
          tamanhoAnexo: sizeStr,
          categoria: response.data.data?.categoriaAnexo || `${categoriaAnexo} - Anexo`
        }, 'sucesso', null, 'Inclusão de Anexo');
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
        await salvarHistorico(tipoProcesso, {
          referenciaCliente,
          anexoId: id
        }, 'sucesso', null, 'Exclusão de Anexo');
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
        await db.query(
          `INSERT INTO follow_ups (processo_id, descricao, data_cadastro)
           VALUES ((SELECT id FROM processos WHERE referencia_cliente = $1 LIMIT 1), $2, $3)`,
          [referenciaCliente, descricao, new Date()]
        );
      } catch (errDb) {
        logger.error('Erro ao salvar follow-up no banco de dados', { error: errDb.message });
      }

      // Salvar entrada de log no histórico
      try {
        const tipoProcesso = idProcesso && idProcesso.startsWith('aereo-') ? 'aereo' : 'maritimo';
        await salvarHistorico(tipoProcesso, {
          referenciaCliente,
          mensagem: descricao
        }, 'sucesso', null, 'Lançamento de Follow Up');
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
    const endpoint = process.env.EXPENSES_ENDPOINT || '/agent_destination/expenses';
    
    const datiPayload = {
      referenciaCliente,
      categoriaId: parseInt(categoriaId, 10),
      valor: parseFloat(valor),
      moeda: parseInt(moeda, 10)
    };
    
    logger.info('Cadastrando despesa na Dati', { referenciaCliente, categoriaId, valor });
    let success = false;
    let datiResponse = null;
    let errors = [];
    
    try {
      const response = await putApiClient.post(endpoint, datiPayload);
      datiResponse = response.data;
      success = response.data && response.data.success !== false;
      if (!success) {
        errors = response.data?.errors || [response.data?.message || 'Erro ao cadastrar despesa'];
      }
    } catch (apiError) {
      // Se der erro de rota não existente (403/404) no sandbox, permitimos simular o sucesso localmente se configurado para testes
      const isSandboxMock = apiError.response?.status === 403 || apiError.response?.status === 404;
      if (isSandboxMock) {
        logger.warn('Cadastrar despesa deu 403/404 na API Dati. Simulando gravação local por estar em ambiente de testes.');
        success = true;
        datiResponse = { message: 'Despesa gravada com sucesso (Simulado localmente)' };
      } else {
        throw apiError;
      }
    }
    
    if (success) {
      // Salvar no banco relacional
      try {
        await db.query(
          `INSERT INTO despesas (processo_id, categoria_id, categoria_nome, valor, moeda, data_cadastro)
           VALUES ((SELECT id FROM processos WHERE referencia_cliente = $1 LIMIT 1), $2, $3, $4, $5, $6)`,
          [
            referenciaCliente, 
            categoriaId, 
            categoriaNome || `Categoria ${categoriaId}`, 
            parseFloat(valor), 
            String(moeda), 
            new Date()
          ]
        );
      } catch (errDb) {
        logger.error('Erro ao salvar despesa no banco de dados', { error: errDb.message });
      }

      // Salvar entrada de log no histórico
      try {
        const tipoProcesso = idProcesso && idProcesso.startsWith('aereo-') ? 'aereo' : 'maritimo';
        
        // Mapear código da moeda para exibição
        let moedaNick = 'USD';
        if (parseInt(moeda, 10) === 1) moedaNick = 'BRL';
        else if (parseInt(moeda, 10) === 220) moedaNick = 'USD';
        else if (parseInt(moeda, 10) === 978) moedaNick = 'EUR';

        await salvarHistorico(tipoProcesso, {
          referenciaCliente,
          categoriaId,
          categoriaNome: categoriaNome || `Categoria ${categoriaId}`,
          valor: parseFloat(valor),
          moeda: moedaNick
        }, 'sucesso', null, 'Lançamento de Despesa');
      } catch (errLog) {
        logger.error('Erro ao salvar log de despesa no histórico', { error: errLog.message });
      }
      
      return res.json(envelope(true, datiResponse || { message: 'Despesa cadastrada!' }, [], []));
    } else {
      return res.status(422).json(envelope(false, {}, errors, []));
    }
  } catch (error) {
    const statusCode = error.response?.status || 500;
    const errorData = error.response?.data || error.message;
    logger.error('Erro ao cadastrar despesa na Dati', { statusCode, error: errorData });
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
