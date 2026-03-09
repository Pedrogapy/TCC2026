# Portal Acadêmico Acessível

Protótipo web para TCC com foco em acessibilidade e rastreamento ocular usando webcam no navegador.

## Objetivo

Simular um software real de gestão acadêmica com:

- login fictício
- dashboard institucional
- CRUD de alunos com persistência local
- painel de acessibilidade
- webcam com rastreamento facial no navegador
- cursor virtual controlado pelo olhar em modo relativo
- alternância entre mover e pausar por piscada longa
- clique automático ao permanecer 7 segundos sobre um elemento clicável

## Tecnologias

- HTML
- CSS
- JavaScript modular
- localStorage / sessionStorage
- MediaPipe Tasks Vision via CDN
- GitHub Pages

## Login de demonstração

- E-mail: `admin@portal.local`
- Senha: `123456`

## Estrutura

```txt
assets/
  css/styles.css
  js/app.js
  js/router.js
  js/storage.js
  js/mockData.js
  js/ui.js
  js/eyeControl.js
docs/
  planejamento.md
index.html
README.md
```

## Publicação no GitHub Pages

O projeto é estático e pode ser publicado diretamente pela branch principal.

## Observações da versão atual

- O sistema já está visualmente pronto para demonstração.
- O rastreamento ocular move o cursor virtual dentro do site.
- O controle é relativo, parecido com joystick ocular.
- A piscada longa alterna entre modo ativo e pausado.
- O clique automático acontece apenas no modo pausado.

## Próximas melhorias sugeridas

- benchmark com tarefas guiadas
- exportação de métricas em JSON/CSV
- calibração leve ao iniciar o modo ativo
- refinamento dos limiares de piscada e suavização
