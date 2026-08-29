# SDD — j-20260828-jf: `aipe shell-hook`, o aviso de update que aparece sozinho

> Journey `j-20260828-jf`, repo `aipe`, specialist Jesse. Derivado do brief
> aprovado. O problema, textual do PE: *"abri um terminal novo — eu veria que há
> update? Não."* Verificado: **nada** no `aipe` escreve em `.bashrc`/`.zshrc`, e o
> único aviso (`maybeOfferUpdate`) está pendurado no `--help`/`--version`, ou seja,
> só conta depois que você já foi fazer outra coisa. O coordenador operou um dia
> inteiro na v1.2.0 com a v1.4.0 publicada. Este SDD entrega o hook de shell que
> avisa **na abertura do terminal**, no mesmo formato do `agentop` (repo
> `agentistics`), sem nunca quebrar o shell de ninguém.

## O comando

`aipe shell-hook install | uninstall | status` — módulo novo em `src/shell-hook/`,
no shape da casa: **decisão em módulo puro e testável, I/O que só lê/escreve/reporta**
(exatamente como o `agentop` separa `claude-hooks.ts` de `cli-hooks.ts`).

- `src/shell-hook/rc.ts` — **puro**. Marcadores, a linha guardada, e as funções
  `planInstall` / `planUninstall` / `fileState` que decidem, sobre uma *string* de
  conteúdo de rc, o que fazer. Nunca toca disco.
- `src/shell-hook/cli.ts` — **I/O**. Lê os rc, aplica o plano, escreve, reporta.
  Registra o subcomando em `src/cli.ts`.

Nome `shell-hook` (não `hooks`) por desambiguação: os *hooks* que o `agentop`
instala vivem em `~/.claude/settings.json` (hooks do Claude Code); o nosso é um
hook de **shell rc**. O nome espelha o path do claim (`src/shell-hook/**`).

## A linha (o que vai no rc)

```
# >>> aipe update check >>>
command -v aipe >/dev/null 2>&1 && aipe check-update 2>/dev/null || true
# <<< aipe update check <<<
```

Cinco coisas que ela acerta, copiadas do `agentop autostart.ts`:

1. **Marcadores estáveis e casados** — mantidos fixos para sempre, para que a
   desinstalação seja exata por casamento de marcador. Mudar um marcador orfanaria
   todo bloco já escrito no rc de alguém.
2. **Uma linha POSIX** — idêntica em bash e zsh (os dois shells que gerimos).
3. **Guardada por `command -v`** — se o binário sumiu do PATH (o caso real de quem
   desinstala), o lado esquerdo falha, o `&&` faz curto-circuito e **nada** roda. O
   shell não quebra.
4. **`|| true` no fim** — melhoria sobre a linha do `agentop`: sem ele, um `aipe`
   ausente deixa `$?` em 1; como esta é a última linha que um rc de login carrega,
   um prompt que mostra o último exit code pintaria um "1" órfão em todo terminal
   novo depois de um uninstall. Com `|| true`, `$?` fica limpo — a linha é silenciosa
   em todos os sentidos. (Provado: `$?=0` com `aipe` ausente.)
5. **`.bashrc` E `.zshrc`** — logins diferentes leem arquivos diferentes; instala
   nos que já existem e, se nenhum existe, cria `~/.bashrc` (padrão histórico).

## Por que não trava o shell (requisito nº 1, acima de tudo)

Verificado o custo real de `aipe check-update` numa abertura:

- **Rede?** Não no hot path. `check-update` lê um cache compartilhado em disco e
  dispara o refresh de rede num processo **destacado** (`spawnCacheRefresh` →
  `child.unref()`). O shell nunca espera a rede.
- **Cache?** Sim — TTL de 3h para "há update", 30min para "está atualizado".
- **Backoff?** Sim — `RETRY_MS` de 15min entre tentativas (20 shells abrindo juntos
  ≠ 20 chamadas ao GitHub).

Logo, **não pode pendurar esperando rede** — que era a condição bloqueante do brief.
O custo é determinístico e limitado (medição abaixo).

## Recusa sem escrever (o rc não é nosso)

`scan()` recusa (`ok:false`) qualquer conteúdo que não seja no máximo **um** bloco
bem-formado: BEGIN sem END, END sem BEGIN, BEGIN aninhado, ou dois blocos completos.
Diante de uma recusa, `install`/`uninstall` **não escrevem nada** naquele arquivo,
reportam o motivo e saem não-zero. Marcador dentro de um `echo "..."` não é
confundido com marcador real (só conta a linha inteira, trimmed).

## Idempotência e inverso exato

- `install` duas vezes → `unchanged` (um único bloco, conta de marcadores = 1).
- `install` sobre um bloco com a linha derivada → `update` in-place, preservando o
  que está em volta.
- `uninstall` é o **inverso byte-a-byte** de `install`: consome o `\n` separador
  antes do BEGIN e o `\n` depois do END. `install → uninstall` restaura o original
  exatamente (provado em teste, arquivo vazio e não-vazio).

## `status` — três estados

Agregado sobre os rc que **existem**: `installed` (em todos), `absent` (em nenhum),
`partial` (em alguns, não todos). Também rotula `stale` (linha antiga) e `malformed`
(bloco corrompido) por arquivo.

## Descoberta (requisito 6) — onde a linha aparece e quando ela para

De nada adianta o comando existir e ninguém saber — o problema que motivou a jornada
foi um coordenador operar um dia inteiro numa versão velha sem nada avisar, e um
comando que só existe no `--help` **não resolve isso**.

**Onde**: no **fim do `aipe start`**, depois dos próximos passos. É o momento em que
a pessoa acabou de materializar um workspace e vai começar a operar — o ponto exato
em que passar a ser avisado de updates importa. Roda raramente (uma vez por
workspace), então não é caminho quente.

**Quando para de aparecer**: assim que o hook está instalado. `startCommand` chama
`suggestInstallLine(home)`, que devolve `null` quando o bloco já está em todos os rc
existentes (verdict `installed`) ou quando há bloco malformado (não empurra alguém
para um comando que vai recusar). O estado é do rc do usuário (global), não do
workspace — então instalar uma vez silencia a oferta em todo `aipe start` futuro.

**Só sugere, nunca instala** (limite duro da spec: instalar é ato do usuário). A
oferta é uma linha de texto; nada é escrito no rc. Provado em teste: depois de um
`start` que ofereceu, o `.bashrc` continua byte-a-byte o que era.

**Injeção**: `StartCommandOptions.home` torna a oferta testável com um HOME
descartável; `run()` passa o `homedir()` real. Sem `home`, nenhuma oferta é avaliada
— o que mantém os testes determinísticos de `startCommand` independentes do rc real
da máquina de CI.

## Medição do custo de abertura (WSL2, binário standalone)

| cenário | custo por abertura de terminal |
|---|---|
| `aipe` ausente do PATH (guarda faz curto-circuito) | **~1 ms** |
| `aipe` presente, cache quente | **~205 ms** |
| baseline `aipe --version` (só startup do binário) | ~210 ms |

Leitura: `check-update` **não acrescenta nada** sobre o startup do próprio binário
standalone (~205ms nesta máquina WSL2); o custo é *startup*, não a lógica de check, e
**nunca** é espera de rede. É o mesmo perfil de custo do hook que o `agentop` já
publica. Reduzir o startup do binário é assunto de como o binário inteiro é compilado
— fora deste escopo.

## Verificação (dirigido de verdade)

Sobre um HOME descartável, com o binário compilado no PATH e o cache semeado:

- `install` em `.bashrc` + `.zshrc` presentes → bloco escrito, conteúdo do usuário
  preservado; segundo `install` → 1 marcador (idempotente).
- **Terminal novo, versão velha (cache 1.7.0→1.9.0)** → **banner aparece** na
  abertura.
- **Terminal novo, atualizado (1.7.0==1.7.0)** → **silêncio** total.
- **Terminal novo, `aipe` removido do PATH** → shell usável, `$?=0`, sem quebra.
- `uninstall` → restaura o rc original byte-a-byte.
- rc estranho (bloco truncado) → **recusado sem escrita**, exit 1.

Portões: `bun test` verde (33 testes novos; 1543 no total), `tsc` silencioso,
`version:check` em sincronia, `build:host` OK.
