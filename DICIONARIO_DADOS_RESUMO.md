# Dicionário de Dados - HEADCARGO
## Extração de 240 páginas - 12/08/2025

## Estrutura das Tabelas

### 1. Acao_Troca_Navio (Ação troca navio)
**Tipo**: Cadastro

| Campo | Tipo de Dados | Tamanho | PK | FK | Mand. | Domínio |
|-------|---------------|---------|----|----|-------|---------|
| IdAcao_Troca_Navio | SmallInt | | ✓ | | ✓ | IdCurto |
| Codigo | VarChar(25) | 25 | | | | AlfaNumerico |
| Descricao | VarChar(200) | 200 | | | ✓ | Descricao |
| Observacao | Text | | | | | Texto |

---

### 2. Acompanhamento (Acompanhamento)
**Tipo**: Movimentação

| Campo | Tipo de Dados | Tamanho | PK | FK | Mand. | Domínio |
|-------|---------------|---------|----|----|-------|---------|
| IdAcompanhamento | Integer | | ✓ | | ✓ | IdLongo |
| IdProjeto_Atividade | Integer | | | ✓ | | IdLongo |
| IdResponsavel | Integer | | | ✓ | ✓ | IdMedio |
| IdGrupo_Envio_Mensagem | SmallInt | | | ✓ | | IdCurto |
| IdGrupo_Tarefa | SmallInt | | | ✓ | | IdCurto |
| IdEmpresa_Sistema | SmallInt | | | ✓ | ✓ | IdCurto |
| Titulo | VarChar(200) | 200 | | | | Descricao |
| Descricao | Text | | | | ✓ | Texto |
| Data | SmallDateTime | | | | ✓ | DataCurta |
| Tipo | TinyInt | | | | ✓ | Externo/Interno (1,2) |
| Data_Retorno | DateTime | | | | | Data |
| Exibir_Portal_Cliente | Bit | | | | | Booleano |
| Observacao | Text | | | | | Texto |

---

### 3. Acompanhamento_Campo_Livre (Acompanhamento - Campo livre)
**Tipo**: Movimentação

| Campo | Tipo de Dados | Tamanho | PK | FK | Mand. | Domínio |
|-------|---------------|---------|----|----|-------|---------|
| IdCampo_Livre | Integer | | ✓ | ✓ | ✓ | IdLongo |
| IdAcompanhamento | Integer | | | ✓ | ✓ | IdLongo |

---

### 4. Acompanhamento_Destinatario (Acompanhamento - Destinatário)
**Tipo**: Movimentação

| Campo | Tipo de Dados | Tamanho | PK | FK | Mand. | Domínio |
|-------|---------------|---------|----|----|-------|---------|
| IdAcompanhamento_Destinatario | Integer | | ✓ | | ✓ | IdLongo |
| IdAcompanhamento | Integer | | | ✓ | ✓ | IdLongo |
| IdPessoa | Integer | | | ✓ | ✓ | IdMedio |
| IdPessoa_Contato | Integer | | | ✓ | | IdMedio |
| Em_Copia | Bit | | | | ✓ | SimNao/Booleano |
| Observacao | Text | | | | | Texto |

---

### 5. Acrescimo_Tipo (Acréscimo tipo)
**Tipo**: Cadastro

| Campo | Tipo de Dados | Tamanho | PK | FK | Mand. | Domínio |
|-------|---------------|---------|----|----|-------|---------|
| IdAcrescimo_Tipo | SmallInt | | ✓ | | ✓ | IdCurto |
| Codigo | VarChar(25) | 25 | | | | AlfaNumerico |
| Descricao | VarChar(200) | 200 | | | | Descricao |
| Observacao | Text | | | | | Texto |

---

## Resumo de Tabelas Encontradas

**Total de páginas**: 240

### Tabelas de Cadastro (início do documento):
1. Acao_Troca_Navio
2. Acrescimo_Tipo
3. Adicao_Documento_Tipo
4. Admissao_Temporaria
5. Agencia_Maritima_Aerea
6. Agrupamento_Demonstrativo
7. Agrupamento_Equipamento_Maritimo
8. Agrupamento_Equipamento_Maritimo_Item
9. Agrupamento_Porto_Item
10. Agrupamento_Porto_Tarifario
11. Armazem
12. Armador
13. Banco
14. Cargo
15. Carteira_Cobranca
16. Categoria_Financeira
17. Centro_Custo
18. Chave_Numeracao
19. Classificacao_Tributaria
20. Cliente
21. Cliente_Classificacao
22. Cobertura_Cambial
23. Cobertura_Seguro
24. Comexpert_Grupo_Documento
... e mais centenas de tabelas

---

## Como Usar Esta Informação

1. **Para Sincronização de Dados**: Consulte a coluna "Domínio" para entender o tipo de valor esperado
2. **Para Mapeamento de API**: Use os "TipoFixo" para enumerar valores possíveis
3. **Para Criar Queries**: Use PK (Primary Key) para identificar chaves primárias
4. **Para Relacionamentos**: Use FK (Foreign Key) para entender conexões entre tabelas

---

**Nota**: Este é um resumo das primeiras páginas. Há muitas mais tabelas. Abra o arquivo `dicionario-dados.txt` na raiz do projeto para ver o conteúdo completo.
