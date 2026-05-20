# MDM Ads Dashboard

Painel web para automação de campanhas na **Meta (Facebook / Instagram Ads)** via Marketing API.

---

## O que você precisa

- **Node.js 18 ou superior** ([nodejs.org](https://nodejs.org/))
- **Cursor** (ou VS Code) com o projeto aberto na pasta `mdm-ads-dashboard`

Para conferir a versão do Node no terminal:

```bash
node --version
```

---

## Como rodar no Cursor e abrir o localhost

### 1. Abrir o projeto

No Cursor: **File → Open Folder** e escolha a pasta `mdm-ads-dashboard`.

### 2. Abrir o terminal integrado

- Atalho: **Ctrl + `** (Ctrl + crase)
- Ou menu: **Terminal → New Terminal**

O terminal deve mostrar o caminho da pasta do projeto.

### 3. Instalar dependências (só na primeira vez ou após mudar o `package.json`)

```bash
npm install
```

### 4. Subir o servidor

**Opção A — uso normal**

```bash
npm start
```

**Opção B — se a porta 3847 já estiver em uso (erro `EADDRINUSE`) no Windows**

Libera a porta e sobe de novo:

```bash
npm run start:fresh
```

### 5. Abrir o link no navegador

Com o servidor rodando, o terminal mostra algo como:

```text
MDM Ads Dashboard — http://localhost:3847
```

Abra no navegador:

**http://localhost:3847**

Esse é o “link ativo” do seu dashboard enquanto o `npm start` estiver rodando.

---

## Porta personalizada (opcional)

Por padrão a porta é **3847**.

Para usar outra (ex.: **3850**):

**Windows (PowerShell)**

```powershell
$env:PORT = "3850"
npm start
```

**Linux / macOS**

```bash
PORT=3850 npm start
```

Ou crie um arquivo `.env` na raiz do projeto (pode copiar de `.env.example`):

```env
PORT=3850
```

O servidor lê o `.env` automaticamente (via `dotenv`).

---

## Modo desenvolvimento (reinicia sozinho ao salvar arquivos)

```bash
npm run dev
```

Útil enquanto edita o código do servidor.

---

## Rodar pelo painel “Run and Debug” do Cursor

1. Aba **Run and Debug** (ícone de play com inseto) ou **F5**
2. Escolha no topo:
   - **MDM Ads: servidor (Node)** — sobe o servidor
   - **MDM Ads: dev (watch)** — `npm run dev` com watch

O link continua sendo **http://localhost:3847** (ou a porta definida em `PORT`).

---

## Conferir se o servidor está no ar

Com o servidor rodando, em outro terminal:

```bash
curl http://localhost:3847/api/health
```

Resposta esperada: `{"ok":true,"service":"mdm-ads-dashboard"}`

---

## Problemas comuns

| Situação | O que fazer |
|----------|-------------|
| **Porta em uso** (`EADDRINUSE`) | `npm run start:fresh` no Windows, ou feche o outro terminal que já está com `npm start`, ou mude `PORT`. |
| **`npm` não encontrado** | Instale o Node.js e reinicie o Cursor. |
| **Página não abre** | Confira no terminal se apareceu a mensagem com `http://localhost:...` e se não houve erro em vermelho. |
| **Mudou a porta** | Use exatamente o número que o terminal mostrou (ex.: `http://localhost:3850`). |

---

## Estrutura rápida

| Pasta / arquivo | Função |
|-----------------|--------|
| `server/index.js` | Servidor Express + API |
| `server/facebookService.js` | Lógica Meta / campanhas |
| `public/` | Interface do dashboard (HTML/CSS/JS) |
| `scripts/free-port.mjs` | Ajuda a liberar a porta 3847 no Windows |

---

## Token e dados da Meta

O token e os IDs são preenchidos **no formulário do site**; não ficam salvos no servidor após a requisição. Use um token válido com permissões de anúncios na conta correta.

Para mais detalhes da API: [Meta Marketing API](https://developers.facebook.com/docs/marketing-apis).
