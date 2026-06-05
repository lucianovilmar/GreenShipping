# Integration Middleware - Instruções Copilot

Este é um sistema Node.js para sincronização de dados entre um banco de dados e uma API externa.

## Descrição do Projeto

Um middleware que:
- Monitora uma fila de dados no banco de dados
- Transforma dados para o formato esperado pela API
- Envia dados para um endpoint de API externa
- Gerencia status de sincronização (pendente, sucesso, erro)
- Implementa retry automático com tratamento inteligente de erros
- Fornece logs detalhados de todas as operações

## Stack Tecnológico

- **Runtime**: Node.js
- **Banco de Dados**: MySQL
- **HTTP Client**: Axios
- **Logging**: Winston

## Estrutura do Projeto

```
src/
├── config/
│   ├── database.js    # Pool MySQL com pool de conexões
│   ├── api.js         # Cliente HTTP para API externa
│   └── logger.js      # Winston logger com arquivo
├── services/
│   └── syncService.js # Orquestração de sincronização
├── utils/
│   └── dataTransformer.js # Transformação e validação de dados
└── index.js           # Ponto de entrada principal
```

## Principais Funcionalidades

1. **Worker em Loop**: Executa ciclos de sincronização em intervalo configurável
2. **Fila de Processamento**: Controla status de cada registro (0=pendente, 1=sucesso, 2=erro)
3. **Retry Inteligente**: Diferencia erros retentáveis de permanentes
4. **Transformação de Dados**: Converte do formato do banco para formato da API
5. **Auditoria Completa**: Logs de sucesso, erro, tentativas e timestamps

## Configuração

Arquivo `.env` com variáveis:
- Credenciais de banco de dados
- URL e credenciais da API
- Intervalo de sincronização
- Configuração de retry

## Como Começar

1. `npm install` - Instalar dependências
2. `cp .env.example .env` - Criar arquivo de configuração
3. Editar `.env` com suas credenciais
4. `npm run dev` - Rodar em desenvolvimento

## Modificações Esperadas do Usuário

O usuário precisará customizar:

1. **Conexão de Banco**:
   - Alterar banco, host, usuário em `.env`
   - Possível mudança para PostgreSQL, SQL Server, etc

2. **Transformação de Dados** (`src/utils/dataTransformer.js`):
   - Adaptar campos específicos do seu banco
   - Ajustar validações e formatações

3. **Estrutura da Fila**:
   - Se banco já tem tabela de dados, posso criar trigger que insere automaticamente
   - Ou usuário pode usar INSERT direto na fila

4. **Formato da API**:
   - Ajustar endpoint, headers, formato de request
   - Tratamento de response específico
