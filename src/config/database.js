const sql = require('mssql');
require('dotenv').config();
const logger = require('./logger');

const dbConfig = {
  server: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 1433,
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'master',
  authentication: {
    type: 'default'
  },
  options: {
    trustServerCertificate: true, // Para SSL auto-assinado
    encrypt: true,
    connectionTimeout: 30000,
    requestTimeout: 30000
  }
};

// Pool de conexões
let pool = null;

async function initializeDatabase() {
  try {
    pool = new sql.ConnectionPool(dbConfig);
    pool.on('error', err => {
      logger.error('Erro no pool de conexões SQL Server', { error: err.message });
    });

    await pool.connect();

    logger.info('Conexão com SQL Server estabelecida com sucesso', {
      server: dbConfig.server,
      database: dbConfig.database
    });

    return pool;
  } catch (error) {
    logger.error('Erro ao conectar ao SQL Server', {
      error: error.message,
      server: dbConfig.server,
      database: dbConfig.database
    });
    throw error;
  }
}

async function query(sqlQuery, inputs = {}) {
  if (!pool) {
    await initializeDatabase();
  }

  const request = pool.request();

  // Adiciona os valores dos parâmetros
  for (const [key, value] of Object.entries(inputs)) {
    request.input(key, value);
  }

  try {
    const result = await request.query(sqlQuery);
    return result.recordset || [];
  } catch (error) {
    logger.error('Erro ao executar query SQL', { error: error.message });
    throw error;
  }
}

async function createIntegrationTable() {
  const sqlQuery = `
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'integracao_fila')
    BEGIN
      CREATE TABLE integracao_fila (
        id INT PRIMARY KEY IDENTITY(1,1),
        status TINYINT DEFAULT 0,
        dados NVARCHAR(MAX) NOT NULL,
        erro_mensagem NVARCHAR(MAX),
        tentativas INT DEFAULT 0,
        criado_em DATETIME2 DEFAULT GETDATE(),
        atualizado_em DATETIME2 DEFAULT GETDATE(),
        enviado_em DATETIME2 NULL,
        INDEX idx_status NONCLUSTERED (status),
        INDEX idx_criado_em NONCLUSTERED (criado_em)
      )
    END
  `;

  try {
    await query(sqlQuery);
    logger.info('Tabela integracao_fila criada ou já existe');
  } catch (error) {
    logger.error('Erro ao criar tabela', { error: error.message });
    throw error;
  }
}

async function closePool() {
  if (pool) {
    await pool.close();
  }
}

module.exports = {
  initializeDatabase,
  query,
  createIntegrationTable,
  closePool,
  dbConfig
};
