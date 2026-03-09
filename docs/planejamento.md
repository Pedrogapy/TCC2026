# Planejamento do Protótipo

## Nome
Portal Acadêmico Acessível

## Problema
Usuários com limitação de uso do mouse tradicional podem precisar de uma alternativa de navegação baseada em webcam e rastreamento do olhar em um ambiente web.

## Proposta
Desenvolver um portal acadêmico fictício com aparência de software real, no qual a interação principal poderá ser feita por um cursor virtual controlado pelo olhar.

## Estratégia técnica adotada
- sistema 100% web e compatível com GitHub Pages
- webcam via navegador
- rastreamento facial em tempo real no browser
- cursor virtual movido por controle relativo do olhar
- piscada longa para alternar entre mover e pausar
- clique automático por permanência de 7 segundos sobre itens clicáveis

## Motivo da abordagem
Evitar dependência de backend, reduzir custo de infraestrutura, facilitar demonstração para banca e manter o foco em engenharia de software com interface, fluxo, persistência local e avaliação prática.

## Entregas já contempladas nesta base
- login fictício
- dashboard
- listagem, cadastro, edição e exclusão de alunos
- persistência local
- painel lateral de acessibilidade
- webcam e cursor virtual
- lógica inicial de rastreamento ocular e alternância por piscada longa

## Próximas etapas
1. testar thresholds de piscada em diferentes ambientes
2. medir latência e estabilidade do cursor
3. criar tela de benchmark com tarefas guiadas
4. salvar resultados de testes em arquivo exportável
5. documentar requisitos funcionais e de qualidade
