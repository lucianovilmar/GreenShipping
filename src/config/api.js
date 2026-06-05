const axios = require('axios');
require('dotenv').config();
const logger = require('./logger');

const apiConfig = {
  baseURL: process.env.API_BASE_URL || 'https://external.dati-api.com/teste',
  timeout: parseInt(process.env.API_TIMEOUT) || 30000,
  apiKey: process.env.API_KEY || ''
};

// Criar instância do axios com configuração padrão
const apiClient = axios.create({
  baseURL: apiConfig.baseURL,
  timeout: apiConfig.timeout,
  headers: {
    'Content-Type': 'application/json',
    ...(apiConfig.apiKey && { 'X-Api-Key': apiConfig.apiKey })
  }
});

module.exports = {
  apiClient,
  apiConfig
};
