const db = require('../config/database');
const api = require('../config/api');
const dataTransformer = require('../utils/dataTransformer');
const logger = require('../config/logger');

// Configurações
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES) || 3;
const RETRY_DELAY = parseInt(process.env.RETRY_DELAY) || 5000;

/**
 * Busca registros pendentes de sincronização
 */
async function getPendingRecords(limit = 10) {
  try {
    const sqlQuery = `
      SELECT TOP (@limit) id, dados, tentativas
      FROM integracao_fila
      WHERE status = 0
      AND tentativas < @maxRetries
      ORDER BY criado_em ASC
    `;

    const records = await db.query(sqlQuery, { 
      maxRetries: MAX_RETRIES,
      limit: limit 
    });
    return records;
  } catch (error) {
    logger.error('Erro ao buscar registros pendentes', { error: error.message });
    throw error;
  }
}

/**
 * Processa e envia um registro para a API
 */
async function processPendingRecord(record) {
  try {
    logger.info('Processando registro', { recordId: record.id });

    // Parse dos dados (já vem como JSON do banco)
    const dbData = typeof record.dados === 'string' 
      ? JSON.parse(record.dados) 
      : record.dados;

    // Transformação dos dados
    const transformedData = dataTransformer.transformDataToAPI(dbData);

    // Envio para API
    const apiResponse = await api.sendData(transformedData);

    if (apiResponse.success) {
      // Sucesso: atualiza status para 1
      await updateRecordStatus(record.id, 1, null);
      logger.info('Registro sincronizado com sucesso', { recordId: record.id });
      return { success: true };
    } else {
      // Erro: verifica se é retentável
      if (apiResponse.isRetryable && record.tentativas < MAX_RETRIES - 1) {
        // Incrementa tentativas e mantém pendente
        await incrementAttempts(record.id);
        logger.warn('Registro marcado para retry', {
          recordId: record.id,
          tentativa: record.tentativas + 1,
          message: apiResponse.message
        });
        return { success: false, retryable: true };
      } else {
        // Erro permanente ou máximo de tentativas atingido
        await updateRecordStatus(record.id, 2, apiResponse.message);
        logger.error('Registro com erro permanente', {
          recordId: record.id,
          message: apiResponse.message
        });
        return { success: false, retryable: false };
      }
    }
  } catch (error) {
    // Erro na transformação ou processamento
    logger.error('Erro ao processar registro', {
      recordId: record.id,
      error: error.message
    });

    // Incrementa tentativas
    if (record.tentativas < MAX_RETRIES - 1) {
      await incrementAttempts(record.id);
      return { success: false, retryable: true };
    } else {
      await updateRecordStatus(record.id, 2, error.message);
      return { success: false, retryable: false };
    }
  }
}

/**
 * Execute o ciclo de sincronização
 */
async function runSyncCycle() {
  try {
    logger.info('Iniciando ciclo de sincronização');

    const records = await getPendingRecords(10);

    if (records.length === 0) {
      logger.debug('Nenhum registro pendente');
      return { processed: 0, successful: 0, failed: 0 };
    }

    logger.info(`Encontrados ${records.length} registros pendentes`);

    let successful = 0;
    let failed = 0;

    // Processa os registros sequencialmente para não sobrecarregar a API
    for (const record of records) {
      const result = await processPendingRecord(record);
      if (result.success) {
        successful++;
      } else if (!result.retryable) {
        failed++;
      }
      // Se é retentável, não conta como falha ainda
    }

    logger.info('Ciclo de sincronização concluído', {
      total: records.length,
      successful,
      failed,
      pending: records.length - successful - failed
    });

    return {
      processed: records.length,
      successful,
      failed
    };
  } catch (error) {
    logger.error('Erro no ciclo de sincronização', { error: error.message });
    return { processed: 0, successful: 0, failed: 0, error: error.message };
  }
}

/**
 * Atualiza status de um registro
 */
async function updateRecordStatus(recordId, status, errorMsg = null) {
  try {
    const sqlQuery = status === 1
      ? `UPDATE integracao_fila SET status = @status, enviado_em = GETDATE() WHERE id = @recordId`
      : `UPDATE integracao_fila SET status = @status, erro_mensagem = @errorMsg WHERE id = @recordId`;

    const inputs = {
      status: status,
      recordId: recordId
    };

    if (status !== 1) {
      inputs.errorMsg = errorMsg;
    }

    await db.query(sqlQuery, inputs);
  } catch (error) {
    logger.error('Erro ao atualizar status do registro', {
      recordId,
      error: error.message
    });
  }
}

/**
 * Incrementa contador de tentativas
 */
async function incrementAttempts(recordId) {
  try {
    const sqlQuery = `UPDATE integracao_fila SET tentativas = tentativas + 1 WHERE id = @recordId`;
    await db.query(sqlQuery, { recordId: recordId });
  } catch (error) {
    logger.error('Erro ao incrementar tentativas', {
      recordId,
      error: error.message
    });
  }
}

module.exports = {
  runSyncCycle,
  getPendingRecords,
  processPendingRecord,
  updateRecordStatus
};
