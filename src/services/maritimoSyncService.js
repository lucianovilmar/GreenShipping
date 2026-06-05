/**
 * Serviço para sincronizar dados Marítimos com a API DATI
 * Estrutura genérica que pode ser adaptada para qualquer tabela
 */

const axios = require('axios');
const { Connection, Request } = require('mssql');
const logger = require('../config/logger');

class MaritimoSyncService {
  constructor() {
    this.apiClient = axios.create({
      baseURL: process.env.API_BASE_URL || 'https://external.dati-api.com/teste',
      timeout: parseInt(process.env.API_TIMEOUT || 30000),
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': process.env.API_KEY || ''
      }
    });
  }

  /**
   * Busca dados do banco de dados que precisam ser sincronizados
   * @param {Connection} dbConnection - Conexão com o banco
   * @param {string} tableName - Nome da tabela a sincronizar
   * @param {string} statusColumn - Coluna de status (0=pendente, 1=sucesso, 2=erro)
   */
  async fetchDataFromDatabase(dbConnection, tableName = 'Navio', statusColumn = 'sync_status') {
    try {
      const query = `
        SELECT TOP 100 * 
        FROM ${tableName}
        WHERE ${statusColumn} = 0
        ORDER BY data_criacao ASC
      `;

      logger.info(`Buscando dados de ${tableName}...`);
      
      const result = await dbConnection.request().query(query);
      logger.info(`Encontrados ${result.recordset.length} registros pendentes de sincronização`);
      
      return result.recordset;

    } catch (error) {
      logger.error(`Erro ao buscar dados de ${tableName}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Mapeia dados do banco para formato esperado pela API
   * ⚠️ IMPORTANTE: Ajuste este mapeamento conforme sua API!
   */
  mapDatabaseToAPI(databaseRecord) {
    return {
      // Exemplo de mapeamento - ADAPTE PARA SUA REALIDADE
      id: databaseRecord.IdNavio || databaseRecord.id,
      nome: databaseRecord.NomeNavio || databaseRecord.nome,
      codigo: databaseRecord.CodigoNavio || databaseRecord.codigo,
      imo: databaseRecord.IMO || null,
      bandeira: databaseRecord.Bandeira || databaseRecord.bandeira,
      tipo_navio: databaseRecord.TipoNavio || 'General Cargo',
      capacidade_teu: databaseRecord.CapacidadeTEU || 0,
      ano_construcao: databaseRecord.AnoConstrucao || new Date().getFullYear(),
      agencia: databaseRecord.IdAgencia || databaseRecord.agencia_id,
      ativo: databaseRecord.Ativo === true || databaseRecord.ativo === 1,
      data_atualizacao: new Date().toISOString()
    };
  }

  /**
   * Envia dados para API via PUT ou POST
   * @param {object} data - Dados a enviar
   * @param {string} method - 'PUT' ou 'POST'
   * @param {string} endpoint - Endpoint da API (ex: '/agcar/maritimo')
   */
  async sendToAPI(data, method = 'PUT', endpoint = '/agcar/maritimo') {
    try {
      logger.info(`Enviando ${method} para ${endpoint}...`);

      let response;
      
      if (method.toUpperCase() === 'PUT') {
        response = await this.apiClient.put(endpoint, data);
      } else {
        response = await this.apiClient.post(endpoint, data);
      }

      logger.info(`✅ Resposta da API: ${response.status}`);
      
      return {
        success: response.data.success !== false,
        data: response.data,
        statusCode: response.status
      };

    } catch (error) {
      logger.error(`❌ Erro ao enviar para API: ${error.message}`);
      
      if (error.response) {
        logger.error(`Status: ${error.response.status}`);
        logger.error(`Resposta: ${JSON.stringify(error.response.data)}`);
      }

      throw error;
    }
  }

  /**
   * Atualiza status do registro no banco após sincronização
   */
  async updateSyncStatus(dbConnection, recordId, status, errorMsg = null) {
    try {
      const query = status === 1
        ? `UPDATE Navio SET sync_status = @status, enviado_em = GETDATE() WHERE IdNavio = @recordId`
        : `UPDATE Navio SET sync_status = @status, erro_mensagem = @errorMsg WHERE IdNavio = @recordId`;

      const request = new Request(dbConnection);
      request.input('status', status);
      request.input('recordId', recordId);
      
      if (errorMsg) {
        request.input('errorMsg', errorMsg);
      }

      await request.query(query);
      logger.info(`Status atualizado para registro ${recordId}`);

    } catch (error) {
      logger.error(`Erro ao atualizar status: ${error.message}`);
      throw error;
    }
  }

  /**
   * Orquestra todo o processo de sincronização
   */
  async syncMaritimo(dbConnection, tableName = 'Navio') {
    try {
      logger.info(`\n${'='.repeat(60)}`);
      logger.info(`🚢 Iniciando sincronização de ${tableName}`);
      logger.info(`${'='.repeat(60)}`);

      // 1. Buscar dados do banco
      const records = await this.fetchDataFromDatabase(dbConnection, tableName);
      
      if (records.length === 0) {
        logger.info('✅ Nenhum registro pendente de sincronização');
        return { processed: 0, success: 0, failed: 0 };
      }

      let successCount = 0;
      let failedCount = 0;

      // 2. Processar cada registro
      for (const record of records) {
        try {
          logger.info(`\nProcessando: ${record.id || record.IdNavio}`);

          // 3. Mapear dados
          const apiData = this.mapDatabaseToAPI(record);
          logger.debug(`Dados mapeados: ${JSON.stringify(apiData)}`);

          // 4. Enviar para API
          const apiResponse = await this.sendToAPI(apiData, 'PUT', '/agcar/maritimo');

          // 5. Atualizar status no banco
          await this.updateSyncStatus(dbConnection, record.id || record.IdNavio, 1);
          
          successCount++;
          logger.info(`✅ Sincronizado com sucesso`);

        } catch (error) {
          failedCount++;
          logger.error(`❌ Falha ao sincronizar: ${error.message}`);
          
          try {
            await this.updateSyncStatus(
              dbConnection, 
              record.id || record.IdNavio, 
              2, 
              error.message.substring(0, 255)
            );
          } catch (updateError) {
            logger.error(`Erro ao registrar falha: ${updateError.message}`);
          }
        }
      }

      // 6. Relatório final
      logger.info(`\n${'='.repeat(60)}`);
      logger.info(`📊 Relatório Final:`);
      logger.info(`   Total processado: ${records.length}`);
      logger.info(`   ✅ Sucesso: ${successCount}`);
      logger.info(`   ❌ Falhas: ${failedCount}`);
      logger.info(`${'='.repeat(60)}\n`);

      return {
        processed: records.length,
        success: successCount,
        failed: failedCount
      };

    } catch (error) {
      logger.error(`Erro fatal na sincronização: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new MaritimoSyncService();
