import { defineConfig } from 'vite';

// Chemins relatifs : le site fonctionne aussi bien à la racine d'un domaine
// que dans un sous-dossier (GitHub Pages : https://<user>.github.io/Flocon/).
export default defineConfig({
  base: './',
});
