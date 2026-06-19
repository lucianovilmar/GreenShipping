const axios = require('axios');
require('dotenv').config();
const logger = require('./logger');

const apiConfig = {
  baseURL: process.env.API_BASE_URL || 'https://external.dati-api.com/teste',
  timeout: parseInt(process.env.API_TIMEOUT) || 30000,
  apiKey: process.env.API_KEY || ''
};

const putApiConfig = {
  baseURL: process.env.PUT_API_BASE_URL || 'https://external.dati-api.com/teste',
  apiKey: process.env.PUT_API_KEY || 's3TnVtnux9aP8qSpEt6ITnLHOjjelPG3MnzYTe0h'
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

// Criar instância do axios para requisições PUT (temporariamente fixada para o ambiente de testes)
const putApiClient = axios.create({
  baseURL: putApiConfig.baseURL,
  timeout: apiConfig.timeout,
  headers: {
    'Content-Type': 'application/json',
    ...(putApiConfig.apiKey && { 'X-Api-Key': putApiConfig.apiKey })
  }
});

module.exports = {
  apiClient,
  apiConfig,
  putApiClient,
  putApiConfig
};
