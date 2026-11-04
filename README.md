# Flocons

Web app contemplative : on fait pousser un flocon de neige unique grâce à une
simulation physique sur grille hexagonale (modèle de Reiter).

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # version statique dans dist/
```

## Fonctionnalités

**Phase 1 — prototype**
- Grille hexagonale, automate cellulaire de Reiter (diffusion de vapeur,
  couche limite, gel à s ≥ 1).
- Rendu Canvas 2D : ciel nocturne, glace translucide, halo, cellules
  fraîchement gelées qui brillent puis s'apaisent, éclats aux pointes.

**Phase 2 — contrôles complets**
- **Humidité** : vapeur ambiante β (plus d'humidité → flocon plus dense).
- **Température** (−25 à −1 °C) : morphologie selon le diagramme de Nakaya —
  plaques (−2 °C), aiguilles (−6 °C), plaques à secteurs (−11 °C),
  dendrites (−15 °C), étoiles (−20 °C). Modifiable pendant la croissance : le
  flocon garde la trace de son « voyage ».
- **Vitesse** : ×0,3 à ×3,5, vitesse de croissance visible constante quelle
  que soit l'humidité.
- **Toucher** : appuyer près du flocon y souffle de la vapeur, ce qui
  accélère la branche voisine et fait naître des ramifications vers elle.
- **Geler** : arrête la croissance ; une onde lumineuse parcourt le cristal,
  la brume se dissipe, quelques éclats scintillent ensuite.
- **Son** (Web Audio) : notes de verre en pentatonique de ré à chaque
  embranchement, arpège au gel, souffle pendant l'injection. Bouton pour
  couper le son (mémorisé).

## Déploiement

Le workflow `.github/workflows/deploy.yml` construit le site et le publie
sur GitHub Pages à chaque push sur `main` (ou à la main depuis l'onglet
Actions). Dans les réglages du dépôt : *Settings → Pages → Source : GitHub
Actions*. Les chemins sont relatifs (`base: './'`), le site fonctionne
donc sous `https://hugohismans.github.io/Flocon/`.

## Architecture

```
src/
  sim/            simulation pure, sans DOM (déplaçable en Worker / shader)
    hexgrid.js    géométrie axiale, voisins, conversions plan <-> cellule
    reiter.js     automate de Reiter, masses en virgule fixe
    random.js     PRNG à graine + dérive lente des conditions
    pacer.js      cadence : vitesse de croissance visible constante
    climate.js    humidité / température -> paramètres du modèle
  render/
    flake-texture.js  état -> couleur par cellule -> pixels (texture)
    scene.js          composition écran : ciel, halo, flocon, éclats, neige
  audio/chimes.js notes cristallines, réverbération, souffle
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
- **Morphologie.** La température agit sur deux leviers : γ (apport de
  vapeur en couche limite, élevé = plaques) et une *cinétique
  d'attachement* (variante de Gravner–Griffeath) : le seuil de gel dépend du
  nombre de voisins déjà gelés. Un seuil élevé sur les flancs des branches
  (2 voisins) freine les ramifications et donne des aiguilles.
- **Embranchements** (pour le son) : une cellule qui gèle avec un seul
  voisin gelé, lui-même pris dans le corps du cristal, est un bourgeon.
- **Performances.** Seul un disque actif (rayon du cristal + 36 cellules)
  est calculé : environ 0,25 ms par pas sur un PC récent.
