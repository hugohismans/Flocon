# Flocons

Web app contemplative : on fait pousser un flocon de neige unique grâce à une
simulation physique sur grille hexagonale (modèle de Reiter).

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # version statique dans dist/
```

## État : phase 1 (prototype)

- Grille hexagonale, automate cellulaire de Reiter (diffusion de vapeur,
  couche limite, gel à s ≥ 1).
- Rendu Canvas 2D : ciel nocturne, glace translucide, halo, cellules
  fraîchement gelées qui brillent puis s'apaisent, éclats aux pointes.
- Un curseur **Humidité** (β du modèle) et un bouton **Nouveau flocon**.

## Architecture

```
src/
  sim/            simulation pure, sans DOM (déplaçable en Worker / shader)
    hexgrid.js    géométrie axiale, voisins, conversions plan <-> cellule
    reiter.js     automate de Reiter, masses en virgule fixe
    random.js     PRNG à graine + dérive lente des conditions
    pacer.js      cadence : vitesse de croissance visible constante
  render/
    flake-texture.js  état -> couleur par cellule -> pixels (texture)
    scene.js          composition écran : ciel, halo, flocon, éclats, neige
  ui/controls.js  liaison des contrôles HTML
  main.js         boucle principale
```

## Choix de modélisation

- **Symétrie d'ordre 6 naturelle.** Le domaine est un disque hexagonal,
  invariant par rotation de 60°. Les masses sont stockées en entiers
  (virgule fixe) : la somme des 6 voisins est exacte et ne dépend pas de
  l'ordre d'addition. En flottant, les erreurs d'arrondi (~1e-7), amplifiées
  par l'instabilité dendritique, suffisaient à déformer les branches.
- **Unicité.** Chaque flocon a une graine qui pilote (1) une dérive lente
  de l'humidité et de l'apport de vapeur, commune à toutes les branches
  (comme le trajet d'un flocon à travers le nuage, ce qui le rend unique
  *et* symétrique), (2) le rayon du noyau en plaque initial, (3) un bruit
  local minuscule (3·10⁻⁵) qui donne de légères imperfections.
- **Performances.** Seul un disque actif (rayon du cristal + 36 cellules)
  est calculé : environ 0,25 ms par pas sur un PC récent.
