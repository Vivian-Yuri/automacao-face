# Configurar Supabase (banco remoto)

O projeto **Automação Face** no Supabase guarda contas, páginas e pixels para todos usarem a mesma lista (local, Render, proxies).

## 1. Criar a tabela

1. Abra [supabase.com](https://supabase.com) → projeto **Automação Face**
2. Menu **SQL Editor** → **New query**
3. Cole todo o conteúdo de `supabase/schema.sql` deste repositório
4. Clique **Run**

## 2. Copiar URL e chave (API)

1. **Project Settings** (engrenagem) → **API**
2. Copie **Project URL** — deve ser assim:
   ```
   https://abcdefghijklmnop.supabase.co
   ```
   (sem barra no final)
3. Em **Project API keys**, copie **service_role** (secret) — **não** use a chave `anon` no servidor

## 3. Arquivo `.env` na raiz do projeto

Na pasta `mdm-ads-dashboard`, crie o arquivo `.env` (não commitar):

```env
PORT=3847
SUPABASE_URL=https://SEU_ID.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Substitua pelos valores reais do passo 2.

## 4. Testar e reiniciar

```powershell
cd "caminho\para\mdm-ads-dashboard"
node scripts/check-supabase.mjs
npm run start:fresh
```

No navegador, abra **Cadastros**. Deve aparecer:

> Armazenamento: Supabase — lista remota compartilhada…

## Erro «Invalid path specified in request URL»

Causas comuns:

| Problema | Solução |
|----------|---------|
| URL com barra no final | Remova: `https://xxx.supabase.co/` → sem `/` final |
| Link do painel do navegador | Use só **Project URL** em Settings → API |
| URL com `/rest/v1` | Use só `https://xxx.supabase.co` |
| Tabela não criada | Rode `supabase/schema.sql` no SQL Editor |
| Chave errada | Use **service_role**, não `anon` |

## Render (produção)

No painel do Render → **Environment**:

- `SUPABASE_URL` = mesmo Project URL
- `SUPABASE_SERVICE_ROLE_KEY` = mesma service_role

Redeploy após salvar.

## Segurança

- Nunca coloque `service_role` no código ou no Git
- Não compartilhe a chave em chat ou capturas de tela
- O arquivo `.env` já está no `.gitignore`
