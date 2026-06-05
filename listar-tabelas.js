/**
 * Script para listar todas as tabelas do banco
 */

const { initializeDatabase, query, closePool } = require('./src/config/database');
const logger = require('./src/config/logger');

async function listarTabelas() {
  console.log('\n🔍 CONSULTANDO TABELAS DO BANCO DE DADOS...\n');

  try {
    await initializeDatabase();

    const sqlQuery = `
      SELECT 
        TABLE_SCHEMA,
        TABLE_NAME,
        TABLE_TYPE
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_SCHEMA, TABLE_NAME
    `;

    const resultado = await query(sqlQuery);

    console.log('═══════════════════════════════════════════════════════════');
    console.log(`📋 Total de tabelas encontradas: ${resultado.length}`);
    console.log('═══════════════════════════════════════════════════════════\n');

    let schemaAtual = null;
    resultado.forEach((tabela) => {
      if (schemaAtual !== tabela.TABLE_SCHEMA) {
        console.log(`\n📂 Schema: ${tabela.TABLE_SCHEMA}`);
        schemaAtual = tabela.TABLE_SCHEMA;
      }
      console.log(`   └─ ${tabela.TABLE_NAME}`);
    });

    console.log('\n═══════════════════════════════════════════════════════════\n');

    // Buscar tabelas com "maritimo", "logistica", "booking", "conhecimento" no nome
    console.log('🔎 TABELAS RELACIONADAS A MARÍTIMA:\n');
    
    const keywords = ['maritimo', 'logistica', 'booking', 'conhecimento', 'embarque', 'navio', 'container'];
    
    keywords.forEach(keyword => {
      const tabelas = resultado.filter(t => 
        t.TABLE_NAME.toLowerCase().includes(keyword.toLowerCase())
      );
      
      if (tabelas.length > 0) {
        console.log(`📌 Com "${keyword}":`);
        tabelas.forEach(t => {
          console.log(`   - ${t.TABLE_SCHEMA}.${t.TABLE_NAME}`);
        });
        console.log();
      }
    });

    console.log('═══════════════════════════════════════════════════════════\n');

    await closePool();

  } catch (error) {
    console.error('❌ ERRO:', error.message);
    logger.error('Erro ao listar tabelas:', error);
    await closePool();
    process.exit(1);
  }
}

listarTabelas();
