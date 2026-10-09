# Cartões de Estudo

Flashcards com repetição espaçada pelo algoritmo SM-2, direto no navegador: você cria baralhos (ou importa de uma planilha), estuda os cartões do dia e cada um volta pouco antes de você esquecer. Bom para vocabulário, fórmulas, conceitos de programação e tudo que precisa ficar na cabeça até a prova.

**Acesse online:** https://micdog22.github.io/cartoes-de-estudo/

## Recursos

- **Baralhos** com cartões de frente e verso, edição, exclusão e busca.
- **Markdown seguro** nos cartões: `**negrito**`, `*itálico*` (ou `_itálico_`) e `` `código` ``, com prévia ao digitar. Todo o resto é escapado.
- **Importação de CSV e TSV** colando o texto ou escolhendo o arquivo: `pergunta;resposta` por linha, com separador detectado sozinho (ponto e vírgula, vírgula ou tab), campos entre aspas, `""` para aspas literais e quebras de linha dentro das aspas. Arquivos em UTF-8 e no formato do Excel em português (Windows-1252) são lidos certinho. Repetidos são ignorados, colunas a mais vão para a resposta e linhas incompletas aparecem com o número.
- **Exportação** de cada baralho em CSV ou TSV (abre direto no Excel em português).
- **Estudo com SM-2:** botões Errei, Difícil, Bom e Fácil mostrando o próximo intervalo de cada um; cartões errados ou difíceis repetem no fim da sessão até sair com Bom ou Fácil.
- **Limite diário de cartões novos** por baralho e fila de revisões vencidas, das mais atrasadas para as mais recentes.
- **Atalhos de teclado:** <kbd>espaço</kbd> mostra a resposta, <kbd>1</kbd> a <kbd>4</kbd> respondem e <kbd>Esc</kbd> sai.
- **Estatísticas:** sequência de dias estudando, acerto nas revisões dos últimos 30 dias, respostas por dia, previsão de revisões para os próximos 14 dias e resumo por baralho.
- **Backup e restauração** em JSON, com validação do arquivo antes de substituir os dados.
- Os dados ficam no `localStorage` do seu navegador: nada vai para servidor nenhum. Funciona no celular, tem tema claro e escuro e é acessível pelo teclado.

## Como usar

1. Em **Baralhos**, crie um baralho (ou clique em "Criar um baralho de exemplo").
2. Em **Editar**, adicione cartões um a um ou cole uma lista:

   ```
   pergunta;resposta
   Capital do Brasil;Brasília
   "2 + 2; quanto dá?";4
   O que `git stash` faz?;Guarda as mudanças **não commitadas**.
   ```

3. Clique em **Estudar**. Leia a pergunta, tente lembrar, aperte <kbd>espaço</kbd> e responda com sinceridade:

   | Botão | Tecla | Nota SM-2 | O que significa |
   |---|---|---|---|
   | Errei | 1 | 1 | não lembrou (o cartão recomeça e repete hoje) |
   | Difícil | 2 | 3 | lembrou com muito esforço (repete hoje, mas conta como acerto) |
   | Bom | 3 | 4 | lembrou depois de pensar um pouco |
   | Fácil | 4 | 5 | lembrou na hora |

4. Volte amanhã: os cartões aparecem de novo quando vencem.

Faça um **backup** de vez em quando em "Backup e ajustes": limpar os dados do navegador apaga os cartões.

## Como rodar localmente

Os módulos ES não carregam via `file://`, então sirva a pasta:

```bash
python3 -m http.server 8000
```

e abra http://localhost:8000.

## Testes

```bash
npm test
```

(ou `node --test`; não há dependências para instalar). Os testes cobrem o SM-2 com sequências calculadas à mão (inclusive o arredondamento exato de intervalos como 25 × 2,26 = 56,5), o piso de 1,3 do fator de facilidade, as datas de calendário (viradas de mês, ano bissexto e horário de verão), a fila do dia com o limite de cartões novos, a sessão com reaprendizado, estatísticas, a leitura de CSV e TSV (aspas, quebras de linha, BOM e CRLF), a ida e volta da exportação, o Markdown seguro contra XSS e a ida e volta do backup com a recusa de arquivos inválidos.

## Como funciona

### Repetição espaçada

A curva do esquecimento de Ebbinghaus mostra que a lembrança cai rápido logo depois de aprender e mais devagar a cada revisão bem-sucedida. A repetição espaçada aproveita isso: em vez de revisar tudo todo dia, cada cartão volta num intervalo que cresce enquanto você acerta. Assim você gasta tempo só com o que está perto de esquecer.

### O algoritmo SM-2

Criado por Piotr Woźniak para o SuperMemo em 1987, ainda é a base de muitos aplicativos de flashcards. Cada cartão guarda três números: quantas repetições seguidas acertou (`n`), o intervalo atual em dias (`I`) e o fator de facilidade (`EF`, começa em 2,5). Para uma resposta com nota `q` de 0 a 5:

- se `q ≥ 3` (lembrou): o intervalo vira 1 dia na primeira repetição, 6 dias na segunda e `I × EF` nas seguintes (arredondado), e `n` aumenta;
- se `q < 3` (esqueceu): `n` volta a 0 e o intervalo volta a 1 dia;
- em toda resposta, o fator é ajustado: `EF' = EF + (0,1 - (5 - q) × (0,08 + (5 - q) × 0,02))`, nunca abaixo de 1,3. Fácil soma 0,1, Bom mantém, Difícil tira 0,14 e Errei tira 0,54.

Na prática, um cartão sempre acertado com Bom volta em 1, 6, 15, 38, 95 dias. Um cartão difícil fica com EF baixo e intervalos que crescem devagar. Seguimos a formulação mais difundida: o intervalo usa o EF de antes da resposta, e o EF é ajustado em toda resposta. Como os ajustes são múltiplos de 0,02, o EF é guardado com duas casas e a multiplicação é feita em centésimos, para que um 56,5 não vire 56,4999... no ponto flutuante.

O SM-2 original também pede que, no fim da sessão, os itens com nota abaixo de 4 sejam repetidos até receberem 4 ou 5. É o que a página faz: Errei e Difícil põem o cartão no fim da fila, e essas repetições do mesmo dia não mexem mais no agendamento. A fila de repetição é reconstruída a partir do histórico do dia, então sair da sessão ou recarregar a página não faz o cartão sumir.

### Fila do dia e estatísticas

As datas são dias do calendário local (`AAAA-MM-DD`) e as contas com datas são feitas em UTC, então mudanças de fuso ou de horário de verão não deslocam vencimentos. A fila do dia traz as revisões vencidas, das mais atrasadas para as mais recentes, e depois os cartões novos, até o limite diário configurado. A taxa de acerto considera só a primeira resposta do dia a cartões que já tinham sido estudados (revisões de verdade), nos últimos 30 dias.

### Segurança

O texto dos cartões nunca vira HTML diretamente: primeiro tudo é escapado (`<` vira `&lt;` etc.) e só depois as marcações de negrito, itálico e código viram as tags `<strong>`, `<em>` e `<code>`. Não há links, imagens nem atributos, então um cartão importado de um CSV desconhecido não consegue executar código na página. O backup restaurado passa por uma validação campo a campo e só é aplicado depois da sua confirmação.

## Contribuindo

Issues e pull requests são bem-vindos.

## Licença

MIT. Veja [LICENSE](LICENSE).
