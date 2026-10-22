# game-route-optimizer

Fundação de uma CLI para futura investigação e análise de conectividade de jogos.
O MVP 0.1.0 exibe apenas nome, versão, sistema operacional, arquitetura e versão
do Node.js. Não altera rotas nem promete melhorias de ping.

## Instalação

Instale Node.js >=22.12.0 com npm, conforme o requisito do Vitest 5. Para executar junto ao jogo no Windows 11, use a
versão nativa do Node.js e um terminal PowerShell na pasta do projeto.

```powershell
npm install
```

O arquivo package-lock.json registra as versões instaladas. Em instalações
posteriores e em CI, use `npm ci` para reproduzi-las.

## Execução

```powershell
npm start
npm run dev
```

`start` executa a CLI TypeScript com tsx. `dev` acompanha alterações dos arquivos.
Para verificar tipos, executar os testes, compilar e executar o JavaScript gerado:

```powershell
npm run check
node dist/index.js
```

Também é possível executar `npm run typecheck` e `npm run build` separadamente.
A compilação produz JavaScript ESM, declarações de tipos e source maps em `dist`.

## Testes

Vitest é o framework oficial de testes, com o provedor de cobertura V8 na mesma
versão. A configuração está em `vitest.config.ts`, com ambiente Node e descoberta
de arquivos `*.test.ts` em `tests/unit` e `tests/integration`.

```powershell
npm test
npm run test:coverage
```

Os comandos executam uma rodada de testes, sem modo watch. A cobertura gera
resumo no terminal e relatórios HTML e LCOV em `coverage`, ignorado pelo Git.
O teste inicial verifica a saída da entrada da CLI; `tests/unit` está reservado
para testes futuros. Não existem testes de monitores ou de casos de uso.

`npm run check` executa typecheck, testes e build nessa ordem e interrompe em
caso de falha. O typecheck inclui código fonte, testes e configuração do Vitest
por meio de `tsconfig.check.json`. O build continua limitado a `src`.

## Estrutura e limites atuais

- `src/index.ts`: entrada da CLI e identificação do ambiente.
- `src/monitors`: reservado para os monitores do Passo 2.
- `src/discovery`, `src/routing`, `src/tunnels` e `src/reports`: reservados para etapas futuras.
- `config`: reservado para configuração futura.
- `tests/unit`: reservado para testes unitários.
- `tests/integration`: teste inicial da saída da CLI.

Os diretórios reservados contêm apenas `.gitkeep`. Ainda não existem monitores,
descoberta de servidores, medições de latência, otimização, túneis ou relatórios.
Nenhuma configuração de rede do sistema é modificada.

O WSL2 pode ser usado para desenvolvimento e compilação. Sua interface e suas
rotas pertencem ao ambiente Linux virtualizado e não representam a rede usada
pelo jogo no Windows. A execução e as futuras medições relacionadas ao jogo
devem ocorrer nativamente no Windows 11.

## Convenção de JSDoc

Funções, métodos, construtores e propriedades de classes devem ter descrição
curta, seguida de linha em branco antes das tags. Para cada parâmetro, use
`@param {Tipo} nome descrição`. Para retornos, quando aplicável, use
`@returns {Tipo}`; a descrição do retorno é opcional. Construtores não recebem
`@returns`. Propriedades de classes não recebem tags de parâmetro ou retorno
quando não aplicáveis. Não documente propriedades individuais de DTOs e
interfaces. Não use comentários inline com barra dupla.
