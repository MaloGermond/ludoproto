# ludoproto

Monorepo Turborepo pour prototypes / sketches.

## Structure

- `projects/` — sketches individuels (workspaces)
- `packages/` — code partagé (workspaces)
- `turbo/generators/` — générateurs de templates

## Installation

```bash
npm install
```

## Créer un nouveau sketch p5.js

```bash
npx turbo gen p5js
```

Répondre au prompt (nom du sketch) → crée `projects/<nom>/` avec `index.html`, `sketch.js`, `package.json`.

Puis :

```bash
cd projects/<nom>
npm install
npm run dev
```

## Commandes globales

```bash
npm run dev     # lance dev sur tous les projets
npm run build   # build tous les projets
npm run new     # alias de `turbo gen`
```
