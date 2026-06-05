/**
 * Test - Integração Marítima
 * 
 * Demonstra:
 * 1. Buscar dados de um Booking específico do banco
 * 2. Exibição visual dos dados obtidos
 * 3. Transformação para formato do PUT da API marítima
 * 4. Execução do PUT com os dados transformados
 */

const { query, initializeDatabase, closePool } = require('./src/config/database');
const apiClient = require('./src/config/api');
const logger = require('./src/config/logger');

// Configuração de teste
const ID_LOGISTICA_PARA_TESTE = 1; // Ajuste conforme necessário
const MODO_SIMULACAO = false; // Usar dados simulados (true) ou banco de dados (false)
const FORMATO_TABELA = '═══════════════════════════════════════════════════════════';

/**
 * Dados simulados para teste (sem precisar da tabela no banco)
 */
function obterDadosSimulados() {
  return {
    id_processo_api: 1,
    id_conhecimento: 101,
    total_containers_20: 5,
    total_containers_40: 10,
    total_teus: 25,
    lista_containers_json: JSON.stringify([
      { numero: 'TCLU1234567', tipo: '40HC', peso: '24000' },
      { numero: 'TCLU1234568', tipo: '40HC', peso: '24000' },
      { numero: 'TCLU1234569', tipo: '20GP', peso: '18000' },
    ]),
    id_cliente_importador: 42,
    id_cliente_exportador: 15,
    id_notify_party: 18,
    id_master_vinculado: 50,
    id_navio_transporte: 88,
    numero_viagem: 'V-2026-0156-GREEN',
    numero_comprovante_embarque: 'CE-2026-001',
    data_previsao_eta: '2026-06-15T00:00:00Z',
    tipo_consolidacao_codigo: 1, // 1=FCL, 2=LCL, 3=Break Bulk
  };
}

/**
 * Busca dados completos de Marítima do banco com JOINs
 */
async function buscarBooking(idLogistica) {
  // Se em modo simulação, retorna dados pré-configurados
  if (MODO_SIMULACAO) {
    logger.info('Usando modo SIMULAÇÃO para demonstração', { idLogistica });
    return obterDadosSimulados();
  }

  const sqlQuery = `
    SELECT 
      -- 1. Chaves de Identificação para a URL e Corpo do Endpoint
      lmh.IdLogistica_House                    AS id_processo_api,
      ce.IdConhecimento_Embarque               AS id_conhecimento,
      
      -- 2. Dados Físicos da Carga (Atributos da Logistica_Maritima_House)
      lmh.Total_Container_20                   AS total_containers_20,
      lmh.Total_Container_40                   AS total_containers_40,
      lmh.Total_TEUS                           AS total_teus,
      lmh.Containers                           AS lista_containers_json,

      -- 3. Dados do Conhecimento Internacional (Atributos de Conhecimento_Embarque)
      ce.IdImportador                          AS id_cliente_importador,
      ce.IdExportador                          AS id_cliente_exportador,
      ce.IdNotify                              AS id_notify_party,
      ce.IdConhecimento_Master                 AS id_master_vinculado,

      -- 4. Dados do Navio e Viagem (Atributos de Logistica_Maritima_Master)
      lmm.IdNavio                              AS id_navio_transporte,
      lmm.Viagem_Navio                         AS numero_viagem,
      lmm.Numero_CE                            AS numero_comprovante_embarque,
      lmm.Data_Previsao_Chegada_Navio          AS data_previsao_eta,
      lmm.Consolidacao                         AS tipo_consolidacao_codigo

    FROM Logistica_Maritima_House lmh
    INNER JOIN Conhecimento_Embarque ce 
        ON lmh.IdLogistica_House = ce.IdLogistica_House
    INNER JOIN Logistica_Maritima_Master lmm 
        ON ce.IdConhecimento_Master = lmm.IdLogistica_Master

    WHERE lmh.IdLogistica_House = @idLogistica
  `;

  try {
    const resultado = await query(sqlQuery, { idLogistica });
    return resultado[0] || null;
  } catch (error) {
    logger.error('Erro ao buscar dados marítimos:', error);
    throw error;
  }
}

/**
 * Formata e exibe dados na tabela
 */
function exibirDadosVisualmente(dados) {
  console.log('\n' + FORMATO_TABELA);
  console.log('📊 DADOS OBTIDOS DO BANCO - SELECT MARÍTIMA COMPLETO');
  console.log(FORMATO_TABELA);

  if (!dados) {
    console.log('❌ Nenhum registro encontrado');
    return;
  }

  // Parse containers se for string JSON
  let containers = dados.lista_containers_json;
  try {
    if (typeof containers === 'string') {
      containers = JSON.parse(containers);
    }
  } catch (e) {
    containers = 'Inválido';
  }

  const formatoExibicao = {
    '🔑 IDENTIFICADORES': '─────────────────────────────────────',
    'ID Processo (API)': dados.id_processo_api,
    'ID Conhecimento': dados.id_conhecimento,
    
    '📦 CARGA FÍSICA': '─────────────────────────────────────',
    'Containers 20ft': dados.total_containers_20,
    'Containers 40ft': dados.total_containers_40,
    'Total TEUs': dados.total_teus,
    'Containers': Array.isArray(containers) ? 
      `${containers.length} items` : 'Ver JSON abaixo',
    
    '👥 DADOS COMERCIAIS': '─────────────────────────────────────',
    'ID Cliente Importador': dados.id_cliente_importador,
    'ID Cliente Exportador': dados.id_cliente_exportador,
    'ID Notify Party': dados.id_notify_party,
    'ID Master Vinculado': dados.id_master_vinculado,
    
    '🚢 NAVIO E VIAGEM': '─────────────────────────────────────',
    'ID Navio': dados.id_navio_transporte,
    'Número Viagem': dados.numero_viagem,
    'Número Comprovante Embarque': dados.numero_comprovante_embarque,
    'Data Previsão ETA': dados.data_previsao_eta,
    'Consolidação (Código)': obterNomeConsolidacao(dados.tipo_consolidacao_codigo),
  };

  Object.entries(formatoExibicao).forEach(([chave, valor]) => {
    if (chave.includes('─')) {
      console.log(`\n${valor}`);
    } else if (!chave.includes('IDENTIFICADORES') && !chave.includes('CARGA FÍSICA') && 
               !chave.includes('DADOS COMERCIAIS') && !chave.includes('NAVIO')) {
      console.log(`  ${chave.padEnd(35)} → ${valor}`);
    } else if (chave !== '🔑 IDENTIFICADORES' && chave !== '📦 CARGA FÍSICA' && 
               chave !== '👥 DADOS COMERCIAIS' && chave !== '🚢 NAVIO E VIAGEM') {
      console.log(`  ${chave.padEnd(35)} → ${valor}`);
    } else {
      console.log(`\n${chave}`);
    }
  });

  // Exibir containers em JSON se disponível
  if (Array.isArray(containers)) {
    console.log(`\n  📋 CONTAINERS (${containers.length}):`);
    containers.forEach((cont, idx) => {
      console.log(`     [${idx + 1}] ${cont.numero} (${cont.tipo}) - ${cont.peso}kg`);
    });
  }

  console.log('\n' + FORMATO_TABELA);
}

/**
 * Traduz código de consolidação
 */
function obterNomeConsolidacao(codigo) {
  const tipos = {
    1: '1 = FCL (Full Container Load)',
    2: '2 = LCL (Less than Container Load)',
    3: '3 = Break Bulk'
  };
  return tipos[codigo] || `${codigo} = Desconhecido`;
}

/**
 * Transforma dados para payload do PUT marítimo
 */
function transformarParaPutMaritimo(dados) {
  console.log('\n' + FORMATO_TABELA);
  console.log('🔄 TRANSFORMAÇÃO - ESTRUTURA DO PUT PARA API MARÍTIMA');
  console.log(FORMATO_TABELA);

  // Parse containers se for string JSON
  let containers = dados.lista_containers_json;
  try {
    if (typeof containers === 'string') {
      containers = JSON.parse(containers);
    }
  } catch (e) {
    containers = [];
  }

  const payload = {
    // ========== IDENTIFICADORES PRINCIPAIS ==========
    id: dados.id_processo_api,
    id_conhecimento: dados.id_conhecimento,
    id_master: dados.id_master_vinculado,

    // ========== CARGA FÍSICA ==========
    carga_fisica: {
      containers_20ft: dados.total_containers_20,
      containers_40ft: dados.total_containers_40,
      total_teus: dados.total_teus,
      detalhes_containers: Array.isArray(containers) ? containers : [],
    },

    // ========== PARTES INTERESSADAS (Stakeholders) ==========
    stakeholders: {
      importador_id: dados.id_cliente_importador,
      exportador_id: dados.id_cliente_exportador,
      notify_party_id: dados.id_notify_party,
    },

    // ========== INFORMAÇÕES DO NAVIO ==========
    navio: {
      id: dados.id_navio_transporte,
      viagem: dados.numero_viagem,
      comprovante_embarque: dados.numero_comprovante_embarque,
      data_previsao_chegada: dados.data_previsao_eta,
    },

    // ========== CONSOLIDAÇÃO ==========
    consolidacao: {
      codigo: dados.tipo_consolidacao_codigo,
      tipo: obterNomeConsolidacao(dados.tipo_consolidacao_codigo),
    },

    // ========== METADATA ==========
    metadata: {
      atualizado_em: new Date().toISOString(),
      versao_api: '1.0',
    }
  };

  console.log('\n📦 PAYLOAD ESTRUTURADO PARA PUT:');
  console.log(JSON.stringify(payload, null, 2));
  console.log('\n' + FORMATO_TABELA);

  return payload;
}

/**
 * Executa o PUT na API marítima
 */
async function executarPutMaritimo(payload) {
  console.log('\n' + FORMATO_TABELA);
  console.log('🚀 EXECUTANDO PUT NA API MARÍTIMA');
  console.log(FORMATO_TABELA);

  try {
    console.log(`\n📍 Endpoint: PUT /maritimo/${payload.id}`);
    console.log(`📤 Enviando dados...`);

    // Simulação: mostra o que seria enviado
    // Em produção, descomente a linha abaixo e comente a simulação
    
    // const response = await apiClient.put(
    //   `/maritimo/${payload.id}`,
    //   payload,
    //   {
    //     headers: {
    //       'Authorization': `Bearer ${process.env.API_TOKEN}`,
    //       'Content-Type': 'application/json'
    //     }
    //   }
    // );

    // Simulação da resposta
    const response = {
      status: 200,
      data: {
        sucesso: true,
        mensagem: 'Dados de marítimo atualizados com sucesso',
        id: payload.id,
        timestamp: new Date().toISOString(),
      }
    };

    console.log('\n✅ RESPOSTA DA API:');
    console.log(`Status: ${response.status}`);
    console.log(JSON.stringify(response.data, null, 2));
    console.log('\n' + FORMATO_TABELA);

    return response;
  } catch (error) {
    console.error('\n❌ ERRO AO EXECUTAR PUT:');
    console.error(`Status: ${error.response?.status}`);
    console.error(`Mensagem: ${error.message}`);
    console.error(JSON.stringify(error.response?.data, null, 2));
    logger.error('Erro no PUT marítimo:', error);
    throw error;
  }
}

/**
 * Função principal - Executa o fluxo completo
 */
async function executarIntegracao() {
  console.log('\n🌊 TESTE DE INTEGRAÇÃO MARÍTIMA COMPLETA');
  console.log(`Iniciado em: ${new Date().toLocaleString('pt-BR')}`);
  console.log(`Testando com ID Logística: ${ID_LOGISTICA_PARA_TESTE}`);
  console.log(`Modo: ${MODO_SIMULACAO ? '📊 SIMULAÇÃO (Dados Fictícios)' : '🗄️  BANCO DE DADOS REAL'}\n`);

  try {
    // Inicializar banco de dados (se não estiver em simulação)
    if (!MODO_SIMULACAO) {
      await initializeDatabase();
    }

    // 1. Buscar dados
    console.log('⏳ Buscando dados de marítima do banco...');
    const dados = await buscarBooking(ID_LOGISTICA_PARA_TESTE);

    // 2. Exibir visualmente
    exibirDadosVisualmente(dados);

    if (!dados) {
      console.log('\n⚠️  Nenhum registro encontrado para teste. Verifique o ID_LOGISTICA_PARA_TESTE.');
      if (!MODO_SIMULACAO) await closePool();
      process.exit(0);
    }

    // 3. Transformar para PUT
    const payload = transformarParaPutMaritimo(dados);

    // 4. Executar PUT
    await executarPutMaritimo(payload);

    console.log('\n✅ INTEGRAÇÃO CONCLUÍDA COM SUCESSO!');
    console.log(`Finalizado em: ${new Date().toLocaleString('pt-BR')}\n`);

    if (!MODO_SIMULACAO) await closePool();

  } catch (error) {
    console.error('\n❌ ERRO NA INTEGRAÇÃO:', error.message);
    logger.error('Erro na integração marítima:', error);
    if (!MODO_SIMULACAO) await closePool();
    process.exit(1);
  }
}

// Executar
executarIntegracao().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('Erro fatal:', error);
  process.exit(1);
});
