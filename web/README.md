# Web panel (build output)

Esta pasta **não contém código-fonte**. Ela guarda só o artefato estático servido por `fxmind painel`.

| O quê | Onde |
|-------|------|
| **Código-fonte React** | `panel/` no repositório workspace pai (`FXMIND/panel/`) |
| **Build (HTML/JS/CSS)** | `fxmind/web/dist/` (gerado pelo Vite) |
| **API + CLI** | `fxmind/scripts/` |

## Build

No workspace pai, o build é executado automaticamente durante a instalação ou
atualização do `fxmind`. Para forçar um rebuild manual:

```bash
npm run build:panel
# ou, dentro de fxmind:
npm run build:web
```

O Vite em `panel/` compila para `../fxmind/web/dist/`.

## Produção

```bash
fxmind painel
```

Abre http://127.0.0.1:3847/chat (UI estática + API). O comando `fxmind painel`
usa o build gerado em `web/dist/`.

## Publicação npm

O pacote `fxmind` inclui `web/dist` no campo `files` do `package.json`. O source em `panel/` fica fora do pacote npm.
