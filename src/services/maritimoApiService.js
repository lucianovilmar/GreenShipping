const logger = require('../config/logger');
const { putApiClient } = require('../config/api');

class MaritimoApiService {
  constructor() {
    this.apiClient = putApiClient;
    this.endpoint = process.env.MARITIMO_PUT_ENDPOINT || '/agent_destination/maritimo';
  }

  async sendMaritimoPut(payload) {
    const hasReference = Boolean(payload.referenciaCliente || payload.numeroBL);
    const requiredFields = ['origem', 'destino', 'modalidadePagamento'];
    const missingFields = requiredFields.filter((field) => !payload[field]);

    if (!hasReference) {
      throw new Error('É necessário informar referenciaCliente ou numeroBL.');
    }

    if (missingFields.length > 0) {
      throw new Error(`Campos obrigatórios ausentes: ${missingFields.join(', ')}`);
    }

    logger.info('Enviando PUT Marítimo para a API do cliente', {
      endpoint: this.endpoint,
      payloadKeys: Object.keys(payload)
    });

    const response = await this.apiClient.put(this.endpoint, payload);

    logger.info('PUT Marítimo enviado com sucesso', {
      status: response.status,
      endpoint: this.endpoint
    });

    return {
      success: true,
      statusCode: response.status,
      data: response.data
    };
  }
}

module.exports = new MaritimoApiService();
