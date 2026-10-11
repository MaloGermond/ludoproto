# fusee-editor

Éditeur 2D de conception de fusées/vaisseaux (issue #29).

```bash
npm run dev    # http://localhost:3000
npm test       # calculs + designs de référence
```

- `config.json` : toutes les données d'équilibrage (modules, moteurs, missions, technologies débloquées, g₀…), modifiable sans toucher au code.
- `src/model.js` : sections, symétrie, étages, moteurs. `src/calc.js` : volumes, masses, Tsiolkovski, poussée/poids, coût.
- `src/references.js` : petit missile, petit lanceur orbital, lanceur lourd (testés dans `test/`).

Hypothèses du prototype : étagement en série (un étage brûle puis est largué ; les boosters latéraux sont simplement rattachés à leur étage), 1 case = 1 m, Isp constant, ergols compris dans le coût du réservoir.
