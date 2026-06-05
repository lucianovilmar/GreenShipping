const logger = require('../config/logger');

/**
 * Transforma dados do banco para o formato esperado pela API
 * IMPORTANTE: Adapte esta função conforme a estrutura real dos seus dados
 * 
 * @param {Object} dbRecord - Registro do banco de dados
 * @returns {Object} Dados transformados
 */
function transformDataToAPI(dbRecord) {
  try {
    // Exemplo de transformação - ALTERE CONFORME SEUS DADOS
    const transformedData = {
      id: dbRecord.id,
      nome: dbRecord.nome?.trim() || '',
      email: dbRecord.email?.toLowerCase().trim() || '',
      telefone: formatarTelefone(dbRecord.telefone),
      cpf: removerMascara(dbRecord.cpf),
      // Adicione outros campos conforme necessário
      // Você pode validar dados aqui também
    };

    // Validação básica
    if (!transformedData.nome) {
      throw new Error('Nome é obrigatório');
    }

    if (!transformedData.email) {
      throw new Error('Email é obrigatório');
    }

    // Valida email
    if (!isValidEmail(transformedData.email)) {
      throw new Error('Email inválido');
    }

    return transformedData;
  } catch (error) {
    logger.error('Erro ao transformar dados', {
      recordId: dbRecord?.id,
      error: error.message
    });
    throw error;
  }
}

/**
 * Formata telefone removendo caracteres especiais
 */
function formatarTelefone(telefone) {
  if (!telefone) return null;
  return telefone.replace(/\D/g, '').slice(-11);
}

/**
 * Remove máscara de CPF
 */
function removerMascara(cpf) {
  if (!cpf) return null;
  return cpf.replace(/\D/g, '');
}

/**
 * Valida email
 */
function isValidEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

module.exports = {
  transformDataToAPI,
  formatarTelefone,
  removerMascara,
  isValidEmail
};
