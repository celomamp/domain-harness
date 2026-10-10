# Harness de Domínio — Análise Executiva e Tese de Mercado

9 de outubro de 2026 · Marcelo Pinheiro

> Complementa o documento de produto `harness-de-dominio.md`. Versão viva e comentável: doc "Harness de Domínio — Análise Executiva e Tese de Mercado".

---

## Veredito

**Recomendação: seguir, mas com a tese reposicionada.** O problema é real e validado por terceiros. A Gartner publicou em junho de 2026 um relatório recomendando exatamente a arquitetura do Harness: controles durante o desenvolvimento mais validação antes do deploy. O risco não é falta de demanda. O risco é que a camada "registrar + orientar via MCP" vire recurso gratuito dos fornecedores em 12 a 18 meses.

O que já é commodity em 2026:

- GitHub Copilot tem instruções por organização (GA em abril de 2026), Cursor tem regras de time obrigatórias, Claude tem skills provisionadas pelo admin e Lovable tem design system e conhecimento de workspace.
- Packmind (França) já distribui "playbooks" para mais de 10 agentes via MCP, em open source.
- Tessl (US$ 125 milhões captados) lançou em agosto de 2026 revisão de PR contra os padrões do time.

O que ainda não tem dono, e onde a tese deve se apoiar:

1. **Governança multinível com semântica corporativa:** árvore de projetos, regras travadas, exceções com prazo, aceite em lote. Nenhum fornecedor de ferramenta vai construir isso de forma neutra.
2. **Inteligência cruzada intenção × resultado:** "consultou mas desviou", aplicações fantasmas, impacto de mudança de padrão, linhagem de dados para LGPD.
3. **Mandato e responsabilidade:** alguém que levanta, mantém e responde pelos padrões. No Brasil, isso é serviço que a Levva já sabe vender.

**A frase de posicionamento sugerida:** "o sistema de registro dos padrões da empresa para a era dos agentes, com prova de aderência". Não "um MCP de padrões".

**Três decisões que recomendo levar à diretoria:**

1. Brasil primeiro, com setores regulados (financeiro, seguros, saúde, varejo grande). EUA só a partir do ano 3, via open source e parceiros.
2. A NewCo vende software. A Levva vende serviços como parceira de implantação preferencial. Misturar as duas receitas derruba o valuation da NewCo.
3. Cobrar por aplicação governada, não por assento. O usuário é a área de negócio, que é grande e flutuante; o valor percebido pela TI é por aplicação sob controle.

---

## Por que agora

A janela está aberta entre 2026 e 2028: o uso de agentes já é massivo, os incidentes começaram e a governança ainda não tem categoria definida.

| Sinal | Dado | Leitura para a tese |
| --- | --- | --- |
| Adoção de agentes | 90% dos devs profissionais usam agentes ao menos semanalmente; 68% diariamente (JetBrains, 2026) | O canal MCP já está instalado na base |
| Shadow AI | 56% dos funcionários usam ferramentas de IA não autorizadas, contra 23% nas governadas (IDC) | A dor de "controle" do caso Ticket é generalizada |
| Gartner, jun/2026 | Recomenda governança em duas camadas: controles no desenvolvimento + validação pré-deploy | É literalmente a arquitetura MCP + gate. Usar no pitch |
| Gartner, jun/2026 | 60% das apps feitas por vibe coding serão aposentadas até 2028 por não gerarem valor previsível | Argumento para o fluxo "nasce aderente" e para o inventário |
| Segurança | 45% do código gerado por IA introduziu ao menos uma falha OWASP Top 10 (Veracode, 2025) | O gate tem valor de risco, não só de padronização |
| Incidentes | CVE-2025-48757 expôs dados de mais de 170 apps em produção feitas no Lovable | Prova concreta para o comitê de risco do cliente |
| Padrões abertos | MCP e AGENTS.md doados à Agentic AI Foundation (Linux Foundation) em dez/2025 | Neutralidade virou viável: o protocolo não pertence a um fornecedor |
| Brasil | 39% das empresas colocam IA generativa como prioridade nº 1 de gasto em TI, à frente de cibersegurança (AWS, 2025) | Orçamento existe; falta talento para governar |

O último ponto é o mais importante para o Brasil: a mesma pesquisa aponta escassez de talento como principal barreira. Isso confirma a hipótese do documento de que o gargalo é mandato e capacidade, não tecnologia.

---

## Mercado: Brasil e EUA

O mercado endereçável de software é de cerca de R$ 290 milhões por ano no Brasil e US$ 600 milhões nos EUA. Somando serviços, o Brasil dobra de tamanho, e é aí que a Levva tem vantagem.

Contexto (TAM): o mercado de assistentes e geração de código com IA é estimado em US$ 16,1 bilhões em 2026 (Mordor). O mercado de TI brasileiro somou US$ 67,8 bilhões em 2025, com software em US$ 21,7 bilhões e crescimento de 21,4% (ABES). O Harness captura uma fatia de governança sobre esse gasto, não o gasto em si.

| | Brasil | EUA |
| --- | --- | --- |
| Empresas no porte-alvo | ~6 mil com 250+ empregados (estimativa a partir do IBGE 2024) | ~20 mil com 500+ empregados (Census SUSB, ordem de grandeza) |
| Fração com maturidade (CI, governança, agentes em uso) | 20% → ~1.200 contas | 30% → ~6.000 contas |
| Ticket médio de software (ACV) | R$ 240 mil/ano | US$ 100 mil/ano |
| SAM software | ~R$ 290 milhões/ano | ~US$ 600 milhões/ano |
| SAM serviços (implantação + 1º ano de manutenção) | ~R$ 730 milhões | Fora do escopo da NewCo |
| SOM em 5 anos | 3–5% das contas: 40–60 clientes, R$ 10–15 milhões de ARR | 0,5%: ~30 clientes, ~US$ 3 milhões de ARR |

Premissas a validar no piloto: a fração "madura" e o ACV. O ACV brasileiro foi ancorado em ferramentas vizinhas: um portal de desenvolvedor como o Cortex custa cerca de US$ 65–69 por usuário/mês, o que dá US$ 78–83 mil/ano para 100 engenheiros.

**Leitura de founder:** o Brasil sozinho sustenta uma empresa de R$ 15–25 milhões de receita com serviços, o que é ótimo para a Levva, mas pequeno para venture capital. Para ser uma empresa de software financiável, a NewCo precisa provar no Brasil e ter um caminho crível para os EUA, ou para multinacionais com operação no Brasil, até o ano 3.

---

## Concorrência

Ninguém cobre as quatro funções de forma neutra e com hierarquia corporativa, mas cada função isolada já tem pelo menos um concorrente forte. A competição real não é outra startup: é o "bom o suficiente" que vem de graça nas ferramentas que o cliente já paga.

| Player | O que faz hoje | Registrar | Orientar | Validar | Inteligência | Neutro | Ameaça |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [Packmind](https://www.everydev.ai/tools/packmind) (FR, ~US$ 1 mi captado) | Playbooks de padrões para 10+ agentes, MCP, open source + Enterprise | Sim | Sim | Lint parcial | Painel básico | Sim | Alta: é o clone mais próximo do núcleo gratuito |
| [Tessl](https://devops.com/ai-agents-are-writing-code-faster-than-anyone-can-review-it-tessl-is-betting-on-standards-to-close-that-gap/) (US$ 125 mi) | Revisão de PR contra padrões do time, skills versionadas | Sim | Via skills | Sim | Não | Sim | Alta nos EUA, baixa no Brasil |
| [Qodo](https://www.qodo.ai/?p=13404) | Revisão de PR, regras mineradas do histórico, governança de skills | Sim | Parcial | Sim | Painel de governança | Sim | Média |
| [Port](https://techcrunch.com/2025/12/11/port-raises-100m-at-800m-valuation-to-take-on-spotifys-backstage) (US$ 800 mi de valuation) | Portal de desenvolvedor + "context lake" e guardrails para agentes | Parcial | Parcial | Scorecards | Sim | Sim | Média: pode descer para esse caso de uso |
| [Cortex](https://rywalker.com/research/cortex) | Portal de desenvolvedor, scorecards, MCP para dados de engenharia | Parcial | Não | Scorecards | Sim | Sim | Baixa |
| [Supernova](https://www.supernova.io/blog/design-system-mcp-servers), Knapsack, zeroheight | Design system com MCP | Só design | Só design | Não | Não | Sim | Parceiros, não rivais: fonte do módulo design |
| GitHub Copilot, Cursor, Claude | Instruções de organização, regras de time, skills provisionadas | Sim | Sim | Copilot review | Uso, não aderência | Não | Alta no "orientar" |
| [Lovable](https://docs.lovable.dev/introduction/lovable-for-enterprise), [Superblocks](https://www.superblocks.com/blog/announcing-superblocks-2-0-a-new-era-for-governed-enterprise-vibe-coding) | Vibe coding governado: design system, conhecimento, scan de segurança | Sim | Sim | Scan próprio | Sim | Não | Alta no público de negócio |
| Snyk, Semgrep, Sonar | Segurança e qualidade de código no CI | Não | Parcial | Sim | Segurança | Sim | Complementares: integrar, não competir |

Dois achados mudam o produto:

- **Lovable e Superblocks já governam o próprio jardim murado.** O usuário de negócio que constrói ali não passa pelo seu gate. A resposta não é integrar com cada um, e sim ser a fonte oficial que alimenta essas ferramentas via API e MCP, e cobrar pela aderência medida.
- **Packmind é a referência mais próxima.** Vale estudar o produto em detalhe e considerar adotar ou contribuir em vez de reconstruir o núcleo open source. O diferencial da NewCo fica acima dele: hierarquia, exceções, inteligência e serviço.

---

## Onde está o fosso

O fosso não está no MCP nem no registro de padrões. Está nos dados de aderência acumulados e no processo de governança que o cliente passa a operar dentro da plataforma.

| Camada | Defensável? | Por quê | Estratégia |
| --- | --- | --- | --- |
| Registro de padrões + MCP com resposta-documento | Não | Fornecedores e Packmind já entregam | Gratuito / open source. É o funil |
| Agente de decisão (resposta-decisão) | Pouco | Modelos melhores reduzem a diferença entre "documento" e "decisão" a cada geração | Vender como economia de tokens e acurácia medida contra o gate, não como inteligência proprietária |
| Hierarquia, regras travadas, exceções com prazo, aceite em lote | Médio | É semântica corporativa que fornecedor de ferramenta não prioriza | Núcleo do plano pago |
| Inteligência cruzada intenção × resultado, análise de impacto, linhagem | Alto | Exige estar nas duas pontas e acumular histórico | Principal motivo de renovação e de upsell |
| Conteúdo de padrões mantido + responsabilidade | Alto no Brasil | Custo de troca: o cliente terceirizou o mandato | Contrato de manutenção via Levva |

**Implicação para o MVP:** a seção 10 do documento de produto prioriza MCP e gate. Recomendo manter, mas instrumentar desde o dia 1 o arquivo de identificação do projeto e os coletores. Sem os dados cruzados, o piloto prova uma funcionalidade que o Copilot já entrega, e não a tese.

**Sobre a métrica de venda em aberto:** use as duas, em momentos diferentes. "% de aplicações aderentes" vende para o comprador de controle (Ticket). "Tempo de aprovação" vende para o patrocinador de arquitetura (Corteva). A métrica interna de negócio deve ser **aplicações governadas ativas**, que também é a métrica de cobrança.

---

## Monetização e precificação

Cobrar por **aplicação governada ativa**, em faixas, com o serviço vendido à parte. Assento penaliza exatamente o que o cliente quer incentivar: mais gente do negócio construindo dentro do padrão.

| Plano | Para quem | Inclui | Preço Brasil | Preço EUA |
| --- | --- | --- | --- | --- |
| Community (open source) | Times técnicos, funil | Registro, MCP com resposta-documento, gate básico via CLI, 1 projeto | Grátis | Grátis |
| Team | Primeira área ou piloto | Até 25 apps, árvore de projetos, gate no CI, painel de aderência | R$ 8 mil/mês | US$ 3 mil/mês |
| Business | Governança corporativa | Até 100 apps, agente de decisão, exceções e aceite em lote, análise de impacto, integração com Jira/Azure DevOps | R$ 20 mil/mês | US$ 8 mil/mês |
| Enterprise | Reguladas e grandes grupos | Apps ilimitadas, linhagem de dados, SSO/SCIM, ambiente dedicado, retenção zero, SLA | A partir de R$ 40 mil/mês | A partir de US$ 15 mil/mês |

O agente de decisão consome tokens. Inclua uma franquia mensal por plano e cobre o excedente com margem, para que o custo do modelo não coma a margem bruta do software.

**Serviços (vendidos pela Levva, ver Estrutura):**

| Serviço | Escopo | Faixa de preço |
| --- | --- | --- |
| Playbook | Guia para levantar e manter padrões | Grátis como isca de leads ou R$ 30–60 mil com workshop |
| Diagnóstico de padrões | 4 semanas: inventário de apps, padrões existentes e lacunas | R$ 80–120 mil |
| Implantação | 8–12 semanas: módulos stack e design system, gate, árvore | R$ 200–350 mil |
| Manutenção contínua | Atualização de módulos, resposta a lacunas e desvios | R$ 20–60 mil/mês |

Referência de custo-hora: sênior entre R$ 180 e 350/h e arquitetura entre R$ 250 e 700/h no Brasil em 2026, segundo levantamento de mercado sem metodologia publicada. Uma manutenção de R$ 30 mil/mês equivale a cerca de 120 horas de sênior.

**Unit economics esperado (Brasil, plano Business):** ciclo de venda de 6 a 9 meses e custo de aquisição estimado em R$ 150–250 mil por conta. Com R$ 240 mil de ACV e cerca de 80% de margem bruta, o payback só do software fica entre 9 e 16 meses. A implantação paga a aquisição no primeiro ano; esse é o argumento econômico do modelo híbrido.

---

## Projeção de 3 anos

No cenário base, a operação consolidada chega a R$ 11,6 milhões de receita e R$ 6,8 milhões de ARR de software no fim do ano 3, com 22 clientes no Brasil e 3 nos EUA. O ponto de equilíbrio fica no ano 4, desde que entrem cerca de 18 novos clientes no Brasil e 6 nos EUA nesse ano.

Cenário base, receita consolidada (NewCo + serviços), em R$ milhões:

| Ano | Clientes (BR / EUA) | Software | Serviços | Receita total | % software | ARR software (fim do ano) | EBITDA |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2027 | 3 / 0 | 0,18 | 1,13 | 1,31 | 14% | 0,36 | -1,30 |
| 2028 | 10 / 0 | 1,30 | 3,39 | 4,69 | 28% | 2,00 | -1,70 |
| 2029 | 22 / 3 | 4,58 | 7,03 | 11,61 | 39% | 6,76 | -1,15 |
| **Acumulado** | | | | | | | **-4,15** |

Leitura: a receita cresce, mas software ainda é minoria no ano 3.

**Premissas:** novos clientes por ano 3, 7 e 12 no Brasil e 3 nos EUA no ano 3, entrando no meio do ano; software a R$ 120 mil, R$ 200 mil e R$ 240 mil de ACV por ano, e US$ 90 mil nos EUA (câmbio de R$ 5,50); implantação de R$ 250 mil por cliente; 70% dos clientes com manutenção de R$ 30 mil/mês; custo de entrega de serviços de 55% da receita; time de produto crescendo de 4 para 11 pessoas a R$ 35 mil/mês.

**O que muda se a NewCo faturar só software (recomendado em Estrutura):** a NewCo queima cerca de R$ 9,3 milhões em 3 anos e a Levva captura cerca de R$ 5,2 milhões de margem de serviços no mesmo período. O consolidado é o mesmo, mas a conversa com a diretoria muda: a Levva financia a NewCo em parte com a margem que a própria NewCo gera para ela. Acima de R$ 3 a 4 milhões de aporte, faz sentido trazer um investidor externo a partir do ano 2, já com os primeiros contratos como prova.

---

## Estrutura: NewCo de software, Levva como parceira

A NewCo deve faturar só software. A Levva fatura os serviços como parceira de implantação preferencial. Isso resolve três problemas de uma vez.

1. **Valuation:** empresas de software são avaliadas por múltiplo de ARR; consultorias, por múltiplo de receita bem menor. Uma NewCo com 60% de serviços é avaliada como consultoria.
2. **Canal:** nos EUA e em outras regiões, a NewCo precisa que outros integradores revendam e implantem. Eles não farão isso se a NewCo competir com eles em serviços.
3. **Foco:** consultoria puxa o time de produto para customização por cliente. Separar as receitas separa os incentivos.

O que a Levva ganha nesse desenho:

- Participação societária relevante na NewCo, em troca do aporte inicial, da pré-venda e do acesso à base de clientes.
- Exclusividade ou preferência de implantação no Brasil por 2 a 3 anos.
- A receita de serviços, que é a maior parte do dinheiro nos primeiros anos (ver Projeção).
- O aprendizado sobre aplicações AI-core de produção, já apontado no documento de produto.

Pontos para resolver antes de constituir a empresa: a propriedade intelectual do que for construído com dinheiro da Levva (cessão ou licença para a NewCo), o vesting dos sócios fundadores, as regras de conflito de interesse para quem está nas duas empresas e um acordo de acionistas que permita a entrada de investidor externo depois. Para entrada nos EUA, prever desde já a possibilidade de uma holding no exterior.

---

## Go-to-market no Brasil

O Brasil é o mercado certo para começar: a Levva tem acesso direto, a concorrência especializada ainda não tem presença local, e o comprador valoriza parceiro local, contrato em reais e dados sensíveis no próprio ambiente.

**Perfil de conta ideal (ICP):** empresa com 1.000+ funcionários, área de arquitetura ou governança de TI formal, pipeline de CI em uso e ao menos uma ferramenta de agente já contratada (Copilot, Cursor ou Claude). Sinal de compra: um gestor como o Vini, que já conectou agentes por conta própria e agora quer padronizar.

**Setores em ordem de prioridade:**

| Setor | Por quê | Gancho de venda |
| --- | --- | --- |
| Financeiro, meios de pagamento e benefícios | Regulação do Banco Central sobre segurança cibernética e terceiros, auditoria frequente | Linhagem de dados e trilha de exceções para o auditor |
| Seguros e saúde | Dados sensíveis sob LGPD | Fontes de informação autorizadas e o que atravessa a fronteira |
| Varejo e bens de consumo | Muitas áreas de negócio construindo, marca forte | Design system e marca, inventário de apps |
| Agro e indústria (caso Corteva) | Arquitetura centralizada e conservadora | Tempo de aprovação |

**Motor de vendas:** venda consultiva conduzida pela pré-venda técnica da Levva nos primeiros 18 meses. Entrada por diagnóstico pago de 4 semanas, conversão para implantação e assinatura. Meta de conversão diagnóstico → assinatura acima de 50%.

**Geração de demanda:** o Levva AI Journey e conteúdo com dados reais de aderência, anonimizados, a partir do 2º cliente. Um relatório anual como "Estado da governança de IA no desenvolvimento no Brasil" cria categoria e lista de contatos.

**Parcerias:** fornecedores de design system (Supernova, zeroheight), ferramentas de segurança no CI (Snyk, Semgrep, Sonar) e os próprios fornecedores de agentes. Para eles, o Harness aumenta a adoção corporativa.

---

## Escopo nos EUA

Não entrar com venda direta antes do ano 3. Os EUA têm o maior mercado, mas também Tessl com US$ 125 milhões, Port avaliada em US$ 800 milhões e os próprios fornecedores de agentes disputando o mesmo espaço. Uma startup brasileira sem casos de referência não ganha essa disputa de frente.

Caminho recomendado, em três etapas:

1. **Anos 1–2, presença sem custo de venda:** o núcleo open source em inglês desde o primeiro commit, documentação em inglês e participação no ecossistema MCP e AGENTS.md. Isso gera usuários e sinal de demanda nos EUA sem time de vendas lá.
2. **Ano 2, cabeça de ponte:** vender para multinacionais que viraram clientes no Brasil e têm operação nos EUA (Corteva é o exemplo natural). A referência vem de dentro do próprio cliente.
3. **Ano 3, canal:** parceria com 1 ou 2 integradores americanos de médio porte que já implantam Copilot, Cursor ou Claude em empresas. Isso só funciona se a NewCo não vender serviços (ver Estrutura).

Diferencial para defender nos EUA: neutralidade entre ferramentas e o painel de aderência, que nenhum concorrente lá entrega cruzando intenção e resultado. O preço em dólar fica cerca de 2 vezes mais alto que o equivalente em reais convertido, o que é normal para SaaS B2B e melhora a margem.

Oportunidade a observar: a União Europeia começou a aplicar o AI Act para sistemas de alto risco em agosto de 2026. Isso cria demanda por trilha de auditoria em multinacionais e pode fazer a Europa ser um segundo mercado melhor que os EUA, especialmente para clientes já atendidos no Brasil.

---

## Riscos estratégicos

O documento de produto já lista bem os riscos operacionais. Abaixo estão os riscos de negócio que uma diretoria ou um investidor vão perguntar.

| Risco | Probabilidade | Impacto | Mitigação |
| --- | --- | --- | --- |
| Fornecedores de agentes absorvem "registrar + orientar" | Alta | Médio | Já tratar essa camada como gratuita; monetizar hierarquia, exceções e inteligência |
| Ferramentas de negócio (Lovable, Replit) ficam fora do gate | Alta | Alto | API de padrões como fonte oficial para essas ferramentas; coletor que lê o repositório sincronizado (Lovable sincroniza com GitHub, GitLab e Bitbucket) |
| NewCo vira braço de serviços da Levva | Média | Alto | Receitas separadas; meta de ARR de software como métrica principal da NewCo |
| Ciclo de venda enterprise longo consome o caixa | Média | Alto | Diagnóstico pago como porta de entrada; piloto pago, nunca gratuito |
| Agente de decisão erra e o gate reprova | Média | Alto | Avaliações por cliente desde o MVP; métrica "decisão recomendada × resultado no gate" publicada no painel |
| Packmind ou Tessl entram no Brasil | Baixa | Médio | Velocidade nos primeiros 10 clientes; profundidade em LGPD e setores regulados; considerar parceria em vez de disputa |
| Responsabilidade contratual por falha em app aprovada | Média | Alto | Contrato de meio, não de resultado; o gate verifica aderência a padrões, não certifica segurança; seguro de responsabilidade profissional |
| Dependência de poucos fundadores com dedicação parcial | Alta | Alto | Ao menos um fundador em tempo integral desde o início |

O último risco merece atenção especial. Uma ideia avaliada "com amigos", financiada por uma consultoria e tocada em paralelo a outros papéis é o padrão mais comum de spin-off que não decola. A diretoria vai querer saber quem acorda pensando só nisso.

---

## O pedido à diretoria e os critérios do piloto

**O pedido: cerca de R$ 1 milhão e 6 meses** para construir o primeiro corte e fechar um piloto pago, com um ponto de decisão no mês 3.

| Item | Premissa | Valor |
| --- | --- | --- |
| Time | 4 pessoas (2 engenharia, 1 engenharia de IA/avaliações, 1 produto/design) a R$ 35 mil/mês com encargos | R$ 840 mil |
| Infraestrutura e modelos | Ambientes, tokens do agente de decisão, ferramentas | R$ 60 mil |
| Jurídico e constituição | NewCo, acordo de acionistas, cessão de PI, contratos-modelo | R$ 90 mil |
| **Total** | | **R$ 990 mil** |

Fora desse valor: um fundador em tempo integral, que pode vir da Levva, e a pré-venda da Levva já existente.

**Etapas e portões de decisão:**

1. **Mês 0–1, compromisso do cliente:** carta de intenção da Ticket com escopo e orçamento de piloto. Sem carta, não se contrata o time.
2. **Mês 1–3, MVP:** módulos stack e design system, MCP, gate no CI, arquivo de identificação e coletores. **Portão no mês 3:** rodando no ambiente da Ticket com ao menos 5 aplicações reais.
3. **Mês 3–6, piloto pago:** medir aderência antes e depois e abrir o segundo piloto (Corteva ou equivalente).

**Critérios de sucesso no mês 6** (recomendo exigir os três):

- [ ] Piloto pago de pelo menos R$ 150 mil, ou contrato anual assinado, com a Ticket.
- [ ] Ganho de aderência medido de pelo menos 20 pontos percentuais nas apps construídas com o Harness, contra a linha de base sem ele.
- [ ] Pelo menos 3 cartas de intenção ou diagnósticos pagos de outras contas.

**O argumento de risco reduzido:** no pior caso, a Levva gasta cerca de R$ 1 milhão e fica com um ativo de pré-venda (playbook, diagnóstico, componentes de gate e MCP) que pode vender como serviço, além do aprendizado sobre aplicações AI-core. O teto da perda é definido pelos portões dos meses 1 e 3.

---

## Fontes

Estimativas próprias (contagem de contas-alvo, ACV, projeção, custo do pedido) estão indicadas no texto como premissas.

- [Gartner: Govern Vibe Coding for Citizen Developers With Self-Service Platforms (resumo Tray.ai, jun/2026)](https://tray.ai/guides/gartner-govern-vibe-coding/)
- [Cloud Security Alliance: The Vibe Coding Governance Gap (jun/2026)](https://labs.cloudsecurityalliance.org/research/csa-research-note-vibe-coding-ai-governance-gap-20260602-csa/)
- [Superblocks: Vibe Coding Enterprise Adoption, 2026 Benchmarks](https://www.superblocks.com/blog/vibe-coding-enterprise-adoption)
- [Superblocks 2.0 (abr/2026)](https://www.superblocks.com/blog/announcing-superblocks-2-0-a-new-era-for-governed-enterprise-vibe-coding)
- [Lovable for Enterprise](https://docs.lovable.dev/introduction/lovable-for-enterprise)
- [Quash: AI Coding Assistant Statistics 2026](https://quashbugs.com/blog/ai-coding-assistant-market-share-statistics)
- [GitHub: Copilot organization custom instructions GA (abr/2026)](https://github.blog/changelog/2026-04-02-copilot-organization-custom-instructions-are-generally-available/)
- [Cursor: Enterprise](https://cursor.com/docs/enterprise)
- [Claude: Organization skills and directory (dez/2025)](https://claude.com/blog/organization-skills-and-directory)
- [SD Times: Agentic AI Foundation (dez/2025)](https://sdtimes.com/ai/linux-foundation-forms-agentic-ai-foundation-to-be-new-home-for-mcp-goose-and-agents-md/)
- [DevOps.com: Tessl Code Review (ago/2026)](https://devops.com/ai-agents-are-writing-code-faster-than-anyone-can-review-it-tessl-is-betting-on-standards-to-close-that-gap/)
- [Tessl: Series A (nov/2024)](https://www.tessl.io/blog/announcing-our-series-a-for-ai-native-software-development)
- [EveryDev: Packmind](https://www.everydev.ai/tools/packmind)
- [Qodo](https://www.qodo.ai/?p=13404)
- [TechCrunch: Port levanta US$ 100 mi a US$ 800 mi (dez/2025)](https://techcrunch.com/2025/12/11/port-raises-100m-at-800m-valuation-to-take-on-spotifys-backstage)
- [Ry Walker Research: Cortex](https://rywalker.com/research/cortex)
- [Supernova: Design system MCP servers](https://www.supernova.io/blog/design-system-mcp-servers)
- [Convergência Digital: TI brasileira cresce 18,5% em 2025 (ABES)](https://convergenciadigital.com.br/mercado/ti-brasileira-cresce-185-em-2025-bate-recorde-impulsionada-pela-forte-demanda-de-hardware-para-ia/)
- [Convergência Digital: Brasil elege IA generativa para investir (AWS, jun/2025)](https://convergenciadigital.com.br/inovacao/brasil-elege-ia-generativa-para-investir-mas-escassez-de-talento-trava-projetos/)
- [IBGE: Cresce o número de empresas no país em 2024](https://agenciadenoticias.ibge.gov.br/pt/agencia-noticias/47285-cresce-o-numero-de-empresas-no-pais-em-2024-mas-salario-medio-fica-estavel.html?lang=pt-BR)
- [TI Inside: Brasil ultrapassa 8,3 milhões de desenvolvedores (GitHub, jul/2026)](https://tiinside.com.br/16/07/2026/brasil-ultrapassa-83-milhoes-de-desenvolvedores-e-356-mil-organizacoes-de-software-aponta-github/)
- [Jobrise: Freelance developer Brasil 2026, preços](https://jobrise.io/pt/blog/freelance-developer-brasil-2026-precos/)
- [U.S. Census Bureau: Statistics of U.S. Businesses](https://www.census.gov/programs-surveys/susb.html)
