# Avatar Studio

Transforme un **enregistrement de voix** ou un **texte** en une vidéo d'un personnage 3D cartoon (buste dans une bulle ronde, fond vert ou transparent) qui parle en lip sync, avec expressions faciales et gestuelle. La vidéo est destinée à être incrustée au montage.

```bash
# Mode A : depuis un enregistrement de voix
npm run avatar -- prepare --audio voix.mp3 --out projets/demo

# Mode B : depuis un texte (synthèse vocale Azure, voix fr-FR-Vivienne HD)
npm run avatar -- prepare --texte script.txt --out projets/demo

# Studio : projets, préparation, pistes éditables, réglages en direct, rendu (dans le navigateur)
npm run avatar -- studio
# ou la prévisualisation d'un projet donné
npm run avatar -- preview projets/demo

# Rendu final (hors ligne, image par image, déterministe)
npm run avatar -- render projets/demo --format mp4          # fond vert
npm run avatar -- render projets/demo --format prores4444   # transparence (.mov)
npm run avatar -- render projets/demo --format webm-alpha   # transparence (.webm)
```

`prepare` produit un dossier projet (`audio.wav`, `transcript.txt`, `performance.json` éditable à la main). `render` ne fait que lire ce dossier. Chaque étape de `prepare` est mise en cache (`cache/`) et n'est recalculée que si son entrée a changé.

---

## 1. Installation

Prérequis : **Node.js 20+**, **ffmpeg** (avec libx264, prores_ks, libvpx-vp9), **Chrome/Chromium**, **Rhubarb Lip Sync**, **whisper.cpp** + un modèle ggml.

```bash
npm install
npm run setup          # vérifie ffmpeg et Chrome, télécharge Rhubarb dans tools/, explique whisper.cpp
cp .env.example .env   # puis renseigner les clés Azure et Anthropic, WHISPER_MODEL, etc.
npm run build          # compile les packages et la page du player
npm run avatar -- check   # bilan : outils, variables, modèle, player
```

### whisper.cpp (transcription locale, horodatage au mot)

- macOS : `brew install whisper-cpp` (binaire `whisper-cli`).
- Linux / Windows : compiler <https://github.com/ggml-org/whisper.cpp> (`cmake -B build && cmake --build build`), le binaire est `build/bin/whisper-cli`.
- Modèle : télécharger `ggml-small.bin` (rapide) ou `ggml-medium.bin` (plus précis) depuis <https://huggingface.co/ggerganov/whisper.cpp/tree/main>.
- Dans `.env` : `WHISPER_BIN=/chemin/whisper-cli` et `WHISPER_MODEL=/chemin/ggml-small.bin`.

### Marionnette 2D (personnage illustré)

Le mode marionnette anime une illustration à partir d'images alignées : une base bouche fermée, une image par forme de bouche Rhubarb (X, A, B, C, D, E, F, G, H), les yeux mi-clos et fermés pour les clignements, et une image par émotion (sourcils et yeux). Les zones de la bouche et des yeux sont découpées automatiquement par différence avec la base, les bords sont adoucis, le fond uni est rendu transparent, et les mêmes couches d'animation qu'en 3D s'appliquent : fondus entre bouches, étirement selon l'énergie, clignements, émotions, micro-mouvements de tête, respiration, hochements.

- Dossier : `assets/marionnette/` avec `marionnette.json` (manifeste : fichiers, couleur de fond à détourer, zones facultatives). C'est le modèle par défaut de `config/scene.json`.
- Génération des images : `docs/prompts-marionnette-2d.xlsx` contient un prompt par image pour un outil d'édition d'images (ChatGPT), avec les noms de fichiers attendus.
- Réglages : Réglages → Marionnette 2D dans le studio (zoom, décalages, mouvements de tête, respiration, étirement de la bouche, adoucissement des bords).
- Les gestes de bras n'existent pas en 2D ; `acquiescement` et `negation` (mouvements de tête) fonctionnent.

### Modèle 3D

Un avatar de démonstration **CC0** est fourni : `assets/models/mpfb-cc0.glb` (créé avec MakeHuman/MPFB, squelette Mixamo, 52 blendshapes ARKit, style réaliste ; voir `assets/models/LICENCE-mpfb.md`). Il sert à valider toute la chaîne et s'affiche sur la page GitHub Pages.

Pour utiliser le vôtre, déposez votre GLB (style cartoon, squelette humanoïde, 52 blendshapes ARKit) dans `assets/models/` et indiquez son nom dans `config/scene.json` → `model`. Puis :

```bash
npm run inspect-model -- assets/models/personnage.glb
```

Le script liste les os, les blendshapes (avec la correspondance ARKit tolérante à la casse et aux séparateurs) et les animations embarquées. Si des os sont signalés manquants au chargement, ajoutez leurs noms dans `config/bones.json` → `aliases`.

Sans modèle, un **personnage de substitution** procédural (tête, yeux, sourcils, bouche, buste, bras) est utilisé : il permet de tester toute la chaîne.

---

## 2. Utilisation

### Le studio (recommandé)

`npm run avatar -- studio` ouvre une application locale dans le navigateur :

- **Projet** : créer un projet, déposer un enregistrement de voix ou un script texte, lancer la préparation (journal en direct), corriger la transcription, lire le rapport de chargement du modèle.
- **Scène et transport** : lecture avec l'audio, image par image (← →), boucle, zoom de la timeline.
- **Timeline d'éditeur** : piste audio (forme d'onde ou spectrogramme calculés dans le navigateur), mots, visèmes, émotions, gestes, énergie et accents, avec en-têtes de pistes et hauteur réglable ; clic pour sélectionner, glisser pour déplacer, bords pour redimensionner, double-clic pour ajouter, Suppr pour supprimer ; `performance.json` est enregistré automatiquement et validé.
- **Pistes** : formulaire d'édition de la sélection et bouton « Générer émotions et gestes sur toute la durée » (procédural, sans LLM : phrases, énergie, accents, ponctuation), qui conserve balises et modifications manuelles.
- **Réglages** : choix du modèle parmi `assets/models/`, test d'un geste à la volée, **fond derrière l'avatar** (palette de teintes ou couleur libre : le dégradé radial qui met l'avatar en valeur, halo clair derrière la tête et bord plus profond, est calculé automatiquement ; un champ CSS libre reste disponible), format et position de la bulle (préréglages carré, paysage bulle à droite ou à gauche, portrait), cadrage, lumière, bouche, expressions, vie procédurale, gestes ; chaque curseur s'applique immédiatement, « Enregistrer » écrit dans `config/`.
- **Poses** : éditeur de blendshapes pour chaque émotion (`emotions.json`) et chaque forme de bouche Rhubarb (`visemes.json`), avec aperçu figé sur le modèle ; création d'émotions.
- **Exporter MP4** (bouton de la barre du haut) : rendu complet de la vidéo puis téléchargement automatique du `.mp4`. En local, c'est le rendu serveur (Chrome headless + ffmpeg, H.264 + AAC, sous-titres SRT à côté). Sans ffmpeg ou Chrome, et sur la page GitHub Pages, la vidéo est encodée **dans le navigateur** (WebCodecs H.264 + AAC, muxage MP4 en mémoire) avec progression et annulation ; Chrome ou Edge recommandés (Chromium sans codecs propriétaires retombe sur VP9 / Opus, signalé par un message).
- **Rendu** : mp4 fond vert, ProRes 4444 ou WebM alpha, extrait `--debut/--fin`, **brouillon** (demi-résolution, quatre fois plus rapide), **sous-titres SRT**, image PNG fixe de la position courante (bulle comprise, fond transparent possible), planche de contrôle, liste des fichiers produits avec aperçu.
- **Journal** : bilan de l'environnement (outils, clés, modèle), file des jobs (préparation, rendu, planche, image), progression, annulation, journal complet.
- Timeline : poignées de redimensionnement des émotions, aimantation aux frontières de mots (Alt pour désactiver), annuler / rétablir (`Ctrl+Z`, `Ctrl+Y`), `Ctrl+S` pour tout enregistrer.

Les fichiers restent la source de vérité : modifier `performance.json` ou `config/*.json` à la main recharge le studio à chaud, et la CLI reste utilisable en parallèle.

### La ligne de commande

| Commande | Rôle |
|---|---|
| `avatar studio [--port 4242] [--transparent] [--no-open]` | ouvre le studio sur tous les projets de `projets/` |
| `avatar prepare --audio X --out DIR` | mode A : normalisation → Whisper → Rhubarb → énergie → annotation LLM → `performance.json` |
| `avatar prepare --texte X --out DIR` | mode B : balises → Azure TTS → normalisation → Whisper → réalignement script ↔ Whisper → … |
| `avatar prepare … --sans-llm` | pas d'appel Anthropic : expressions et gestes issus des balises et du procédural |
| `avatar prepare … --force` | ignore le cache |
| `avatar prepare … --rapide` | préparation rapide sans Whisper ni Rhubarb (ffmpeg suffit) : lip sync approximatif calculé depuis l'audio (énergie et spectre), pas de mots, émotions et gestes procéduraux ; convient pour dégrossir, préférer Rhubarb pour la version finale |
| `avatar preview DIR [--port 4242] [--transparent]` | ouvre le studio directement sur un projet |
| `avatar render DIR --format mp4\|prores4444\|webm-alpha [--debut s] [--fin s] [--out f] [--frames dir] [--brouillon] [--srt]` | rendu déterministe avec barre de progression ; `--brouillon` = demi-résolution rapide, `--srt` = sous-titres à côté de la vidéo |
| `avatar planche DIR [--emotions] [--os "rightArm=0,0,-100;rightForeArm=-90,0,0\|head=0,30,0"]` | planche de contrôle PNG : pose de repos, chaque geste procédural à mi-parcours, chaque émotion, ou des rotations d'os à tester ; sert à régler `config/gestures.json` à l'œil |
| `avatar test-project DIR [--duree 4] [--visemes]` | projet de test : son de test (bip chaque seconde) + animation de test (rotation de tête, `jawOpen` sinusoïdal) |
| `avatar check` | vérifie outils, variables d'environnement, modèle et player |
| `npm run smoke` | vrai appel de bout en bout avec les clés de `.env` (TTS, Whisper, Rhubarb, LLM, rendu) |

`npm run avatar -- <commande>` (ou `npx avatar <commande>` après `npm run build`).

### Balises de jeu (mode B)

```
[enjoué] Bonjour à tous ! [geste:salut] Aujourd'hui, on va parler de…
[sérieux] Attention, ce point est important. [geste:index]
```

`[émotion]` s'applique jusqu'à la prochaine balise d'émotion ; `[geste:nom]` se déclenche sur le mot qui suit. Les balises sont retirées avant l'envoi à Azure, prioritaires sur l'annotation automatique ; une balise inconnue produit un avertissement avec la liste des valeurs valides.

Émotions : `neutre`, `enjoué`, `sérieux`, `surpris`, `inquiet`, `complice`, `enthousiaste`, `pensif` (clés de `config/emotions.json`).
Gestes : `salut`, `explication`, `index`, `haussement_epaules`, `mains_ouvertes`, `acquiescement`, `negation`, `reflexion` (clés de `config/gestures.json`).

### Corriger la transcription (mode A)

Éditez `projets/demo/transcript.txt` puis relancez `prepare` : seuls le réalignement et l'annotation sont recalculés (Whisper et Rhubarb restent en cache).

### Retoucher `performance.json`

Le fichier est validé au chargement avec des messages lisibles (chemin + valeur fautive). Format :

```json
{
  "version": 1, "fps": 30, "duration": 42.18, "audio": "audio.wav", "text": "…",
  "words":       [{ "w": "Bonjour", "start": 0.71, "end": 1.13 }],
  "visemes":     [{ "start": 0.0, "end": 0.71, "shape": "X" }],
  "energy":      { "rate": 30, "values": [0.02, 0.11] },
  "accents":     [0.84, 2.60],
  "expressions": [{ "start": 0.5, "end": 3.9, "emotion": "enjoué", "intensity": 0.8, "source": "llm" }],
  "gestures":    [{ "at": 1.4, "clip": "salut", "source": "balise" }],
  "seed": 12345,
  "padding": { "before": 0.5, "after": 0.5 }
}
```

Le schéma JSON est exporté par `PERFORMANCE_JSON_SCHEMA` (`packages/shared/src/performance.ts`). Les temps incluent le silence de repos ajouté avant la parole (`padding.before`).

---

## 3. Réglages visuels (`config/`)

**Forme de la bulle** : `scene.bubble.shape` vaut `cercle` (défaut) ou `carre` (cadre carré à coins arrondis, rayon `scene.bubble.cornerRadius` en pixels, 0 = angles vifs). `diameter` est alors le côté du carré. Préréglage « Carré 1080, cadre carré arrondi » dans le studio ; même forme dans la page, le rendu serveur et l'export navigateur.

**Fond derrière l'avatar** : `scene.bubble.couleur` (hexadécimal) définit la teinte ; le dégradé est calculé par `gradientFromColor` (halo à 50 % / 35 %, teinte à 60 %, bord plus sombre et plus saturé à 100 %), identique dans la page, le rendu serveur et l'export navigateur. `scene.bubble.fondLibre: true` utilise `scene.bubble.background` (CSS quelconque) à la place.

Tout ce qui est esthétique est dans `config/` ; la prévisualisation se recharge à chaque sauvegarde.

| Fichier | À regarder / régler |
|---|---|
| `scene.json` | `model`, `resolution`, `fps`, `padding` ; **bulle** (`bubble.diameter`, `margin`, `position` = centre en pixels ou `center`, fond CSS, anneau) ; **cadrage** (`camera.bottomRatio` = fraction de la hauteur du modèle où commence le cadre, `marginTop`, `distanceScale`, `heightOffset`, `fov`) ; **éclairage** trois points + `eyeCatch` (positions relatives au centre du cadre), `exposure`, `environment` ; **bulle** (`diameter`, `margin`, `background` CSS, `ring`) ; fond vert (`background.color`) ; **vie procédurale** (`life.blink`, `gaze`, `breathing`, `head`, `brows`) |
| `visemes.json` | poids de blendshapes par forme Rhubarb (A…H, X), `transitionMs` (60–90), `anticipationMs` (30–50), `exaggeration` (1.2), `energyInfluence` |
| `emotions.json` | pose de chaque émotion, `fadeMs` (400), `speechAttenuation` (atténuation de la zone bouche pendant la parole) |
| `gestures.json` | `source` (`auto` / `clips` / `procedural`), `fadeMs`, `intensity`, `idle` (balancement ou clip de repos), correspondance nom → clip, gestes procéduraux par images clés (rotations d'os en degrés) |
| `bones.json` | alias de noms d'os, liste des os du haut du corps conservés pour les clips |

### Pose de repos et gestes procéduraux

Les modèles sont souvent livrés en A-pose ou T-pose : `gestures.restPose` (degrés par os) ramène les bras le long du corps, et les gestes procéduraux s'ajoutent par-dessus (rotations composées, pas additionnées). **Le sens des axes dépend du squelette.** Sur l'avatar de démonstration (squelette MPFB/Mixamo), depuis la pose de repos : bras `Z < 0` = lever sur le côté, bras `Y > 0` (droite) / `Y < 0` (gauche) = avancer, bras `X < 0` = écarter ; avant-bras `Z < 0` = plier vers l'avant, `X < 0` = plier vers le haut quand le bras est levé. Pour un autre modèle, lancez `avatar planche projets/test --os "rightArm=45,0,0|rightArm=0,45,0|rightArm=0,0,45|rightForeArm=45,0,0|rightForeArm=0,45,0|rightForeArm=0,0,45"` et lisez la planche pour retrouver le sens de chaque axe, puis ajustez `restPose` et les images clés.

Points à vérifier à l'œil : cadrage (marge au-dessus de la tête, place pour les bras), amplitude de la bouche (`exaggeration`, `jawOpen` de la forme D), sobriété de la vie procédurale (`life.head.amplitude`), naturel des gestes (amplitudes dans `gestures.procedural`).

---

## 4. Structure du dépôt

```
packages/
  shared/     types, validation de performance.json, PRNG, les 4 couches d'animation (fonctions pures de t)
  pipeline/   audio, tts (Azure), transcribe (whisper.cpp), align, tags, rhubarb, energy, annotate (Anthropic), cache, prepare
  player/     page Three.js : scène, bulle, modèle, clips, marionnette 2D (puppet.ts), window.loadProject / renderFrame(t) ; ui/ = studio
  renderer/   serveur local et API du studio (projets, config, jobs, journal), Chrome headless (Puppeteer), capture PNG → ffmpeg, planche
  cli/        commandes studio, preview, prepare, render, planche, test-project, check
config/       scene.json, visemes.json, emotions.json, gestures.json, bones.json
assets/       models/ (GLB), clips/ (animations externes), marionnette/ (images du personnage 2D + manifeste)
scripts/      setup, inspect-model, smoke
tests/        WAV de référence versionné, test de déterminisme du rendu, test du script d'inspection
projets/      dossiers de travail (non versionnés)
```

Interfaces à un seul fichier pour changer de fournisseur : `TtsProvider` (`pipeline/src/tts/`), `Transcriber` (`pipeline/src/transcribe/`), `Annotator` (`pipeline/src/annotate.ts`), `GestureSource` (`shared/src/anim/gestures.ts`, implémentations procédurale et par clips).

Variables d'environnement : `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`, `AZURE_TTS_VOICE`, `AZURE_TTS_TEMPERATURE`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `WHISPER_BIN`, `WHISPER_MODEL`, `RHUBARB_PATH`, `FFMPEG_PATH`, `CHROME_PATH`. Aucune clé n'est écrite dans le code, les journaux ou `performance.json`.

---

## 5. Comment ça marche

1. **Normalisation** : WAV mono 48 kHz 16 bits, `loudnorm` en deux passes (mesure puis gain linéaire : pas de pompage ni de distorsion), silence de repos avant et après (`scene.padding`). Ce WAV est la référence unique pour Rhubarb, Whisper, l'énergie et le mixage.
2. **Transcription** : whisper.cpp, langue `fr`, un mot par segment. Mode B : alignement de séquences (LCS tolérant) entre les mots du script et ceux de Whisper, interpolation des mots sans correspondance.
3. **Lip sync** : `rhubarb -f json --recognizer phonetic --extendedShapes GHX`.
4. **Énergie** : enveloppe RMS (fenêtres de 20 ms), normalisée, rééchantillonnée à la cadence vidéo ; pics d'accent.
5. **Annotation** : API Anthropic, sortie JSON structurée validée par schéma, vocabulaire fermé, une nouvelle tentative puis repli. Sans clé ou avec `--sans-llm`, un générateur procédural couvre toute la durée : phrases (mots ou silences), énergie moyenne, densité d'accents et ponctuation choisissent l'émotion ; un geste toutes les 4 à 6 secondes sur les accents, choisi selon l'émotion.
6. **Animation** (identique en prévisualisation et en rendu) : bouche (transitions adoucies, anticipation, énergie, exagération, priorité sur les expressions) + expressions (fondu 400 ms, atténuation zone bouche) + vie procédurale (clignements, saccades, respiration, micro-mouvements, sourcils sur accents, tout aléatoire issu de `seed`) + gestes (clips mélangés via `AnimationMixer` piloté par `t`, ou repli procédural).
7. **Rendu** : Chrome headless (ANGLE ; SwiftShader en repli avec avertissement), `renderFrame(t)` pour `t = n / fps`, capture PNG → ffmpeg sur stdin. Aucun `requestAnimationFrame`, `Date.now` ou `performance.now` dans le chemin de rendu.

### Regard, sourcils, sourire, mains, suivi des cheveux

Douze images optionnelles enrichissent la marionnette (prompts dans `docs/prompts-marionnette-2d-phase1.xlsx`), déclarées dans `marionnette.json` :

- `gaze` (`left`, `right`, `up`) : les saccades du regard calculées par la vie procédurale deviennent visibles (pupilles déplacées), uniquement sur les yeux de base : une émotion garde ses propres yeux, un clignement passe au-dessus.
- `brows` (`up`, `down`) : sourcils levés sur les accents forts (seuil `marionnette.sourcilsAccent`), froncés à la place pendant une émotion « sérieux ».
- `mouthsSmile` (mêmes clés Rhubarb, ici X, B, D) : bouches souriantes utilisées pendant les émotions listées dans `smileEmotions` (défaut `enjoué`), les autres formes restent normales.
- `hands` (clé = nom de geste : `salut`, `explication`, `index`, `approbation`) : la piste gestes devient active en 2D, la main apparaît et disparaît avec le fondu des gestes (`gestures.fadeMs`). `mains_ouvertes` et `pouce` sont des alias.

Chaque calque n'est composé que dans sa zone (yeux seuls, bande des sourcils, bouche, tout le cadre sauf le visage pour les mains) : une image de regard qui aurait aussi changé la bouche, ou une image de main qui aurait changé les sourcils, ne pollue pas le reste. Les images sont détourées sur leur propre couleur de fond (médiane des bords), plus largement là où la base est déjà du fond.

`npm run verif-marionnette [projet] [dossier]` passe toutes les combinaisons (émotion × bouche × clignement × regard × sourcils × mains) dans Chrome headless, vérifie qu'aucun calque ne modifie l'image hors de sa zone, et écrit une vignette par combinaison pour contrôle visuel.

Sans image supplémentaire, la phase « mouvement » ajoute : hochement sur les accents (`life.head.nodOnAccent`), inclinaison de la tête à la fin des phrases interrogatives (`life.head.tiltOnQuestion`, signe alterné), suivi retardé des cheveux et découplage du buste (`marionnette.suivi` : la tête bouge, le buste suit à 40 %, les cheveux traînent de 90 ms), et une ombre de contact du personnage sur le fond de bulle (`marionnette.ombre`).

### Une image propre, sans grésillement

Les images d'une marionnette générées par IA portent chacune un **grain différent**. Si l'on composait la zone entière de chaque bouche ou de chaque émotion, ce grain changerait à chaque forme de bouche (dix fois par seconde) : c'est le grésillement que l'on voit autour de la bouche et des yeux. Le compositeur ne colle donc que le **vrai changement** :

- `marionnette.seuilBruit` (défaut 20) : sous ce seuil, une différence entre une image et la base est considérée comme du grain et ignorée. Le masque retenu est l'union des zones que toutes les bouches (ou tous les yeux) modifient, dilatée puis fondue sur une vingtaine de pixels : la bouche au repos disparaît bien sous une bouche ouverte, sans bord visible. 0 = ancien comportement (zone entière).
- `marionnette.lissage` (défaut 0,6 px) : léger lissage du grain des images sources, invisible à la résolution de sortie.
- Le canvas de la marionnette est mis à l'échelle en qualité haute (mipmaps), ce qui évite le fourmillement des détails fins pendant les micro-mouvements de tête.

Côté encodage, le rendu serveur utilise x264 `crf 16`, `preset slow`, AAC 192 kbit/s ; l'export navigateur vise 0,3 bit par pixel et par image (10 Mbit/s en 1080² à 30 i/s). Si le grésillement persiste sur une plateforme de diffusion, c'est sa recompression : livrer un fichier plus lourd (ProRes 4444 via `--format prores4444`) ou monter le `crf` à 14 dans `packages/renderer/src/ffmpeg.ts`. Pour l'incrustation, gardez à l'esprit que le MP4 est en 4:2:0 : le bord de la bulle sur le fond vert peut montrer un liseré au keying ; préférez alors ProRes 4444 ou WebM alpha, qui portent une vraie couche alpha.

---

## 6. Tests

```bash
npm test          # vitest : logique pure, intégration (ffmpeg), déterminisme du rendu (Chrome + player construit)
npm run typecheck
```

Les appels Azure, Whisper et LLM sont simulés dans les tests ; `npm run smoke` fait un vrai appel de bout en bout. Le test de déterminisme rend deux fois le même extrait et compare les hash SHA-256 des images.

---

## 7. GitHub Pages

GitHub Pages n'héberge que des fichiers statiques : **la chaîne complète (`prepare`, `render`, Rhubarb, Whisper, Azure, Anthropic, ffmpeg, Chrome) tourne sur votre machine, pas sur Pages.** Ce qui se publie sur Pages est la **page du player en mode démo** : le personnage dans sa bulle sur fond vert, animé par une performance de test, avec les pistes et le rapport de chargement. On peut y déposer (glisser-déposer) son `.glb`, un `performance.json` et l'audio produits par la CLI pour les visualiser dans le navigateur, ou simplement un `.mp3` / `.wav` : la page construit une performance sur toute sa durée (lip sync approximatif, émotions et gestes procéduraux) et le bouton **Exporter MP4** encode la vidéo finale directement dans le navigateur (WebCodecs, sans serveur).

Le workflow `.github/workflows/pages.yml` construit et déploie le player à chaque push sur `main`. Pour publier :

1. Fusionner cette branche dans `main` (ou pousser sur `main`).
2. Sur GitHub : **Settings → Pages → Build and deployment → Source : GitHub Actions**.
3. Attendre le workflow « GitHub Pages (démo du player) » ; l'URL est `https://<utilisateur>.github.io/lipsync-app/`.

La page affiche le modèle indiqué dans `config/scene.json` s'il est présent dans le dépôt (l'avatar CC0 fourni l'est ; les fichiers de `assets/models/` et `config/` sont copiés dans le site). Pour publier votre propre modèle, ajoutez une exception dans `.gitignore` comme pour `mpfb-cc0.glb`. Un modèle acheté a souvent une licence qui interdit la publication : dans le doute, gardez-le hors du dépôt et utilisez le glisser-déposer.

---

## 8. État des jalons et limites connues

| Jalon | État |
|---|---|
| 1 Squelette, `setup`, `inspect-model`, GLB en buste dans la bulle | fait ; à valider visuellement avec votre GLB |
| 2 Rendu déterministe (test : rotation de tête + `jawOpen` sinusoïdal) | fait et testé : images identiques octet pour octet, durée vidéo = durée audio |
| 3 Mode A bouche seule (normalisation, Rhubarb, visèmes, rendu) | codé ; à valider à l'œil sur un mp3 français (Rhubarb à installer via `npm run setup`) |
| 4 Whisper, `transcript.txt`, énergie, vie procédurale | codé (whisper.cpp) ; à valider |
| 5 Mode B : balises, Azure TTS Vivienne HD, réalignement | codé ; l'existence de la voix dans la région est vérifiée au premier appel |
| 6 Expressions, annotation LLM, priorité des balises, fondus | codé ; à valider |
| 7 Gestuelle : clips (retargeting par noms d'os) ou repli procédural | codé ; gestes procéduraux calibrés sur l'avatar CC0 fourni (planche de contrôle dans `avatar planche`) ; le retargeting de clips suppose des poses de repos compatibles |
| 8 Prévisualisation avec pistes et rechargement à chaud, sorties transparentes, cache, README | fait |

Limites et points de vigilance :

- **Retargeting** : les clips (GLB embarqué ou `assets/clips/*.glb`) sont retargetés par table de noms d'os, sans correction de pose de repos. Si les squelettes diffèrent (Mixamo vs modèle acheté), le résultat peut être déformé : passez `gestures.source` à `procedural`, ou préparez les clips dans Blender sur le squelette du modèle.
- **Voix DragonHD** : la température est passée en SSML par l'attribut `parameters="temperature=…"` de `<voice>`, conformément à la documentation Microsoft des voix HD ; le SSML reste minimal (`<speak>`, `<voice>`). Si Azure renvoie une erreur 400, vérifiez la documentation en vigueur.
- **Rendu logiciel** : sans GPU, Chrome utilise SwiftShader (environ 2 à 3 images/s en 1080 × 1080). Le résultat est identique, seulement plus lent.
- **Formats GLB** : Meshopt est pris en charge ; Draco et KTX2 ne le sont pas (ré-exportez sans compression).
- **Vidéos longues** : la chaîne est prévue pour des fichiers de 30 minutes et plus (timeline, analyse audio adaptative, préparation rapide d'un fichier de 20 minutes en une trentaine de secondes). Le rendu, lui, prend du temps : comptez la durée de la vidéo multipliée par 30 divisée par la cadence de rendu (2 à 30 images par seconde selon la machine), et utilisez `--brouillon` pour valider avant le rendu final.
- **Vérification audio/vidéo** sur une vidéo longue : rendez `avatar test-project projets/long --duree 180` puis `render` et contrôlez le bip de chaque seconde en fin de fichier.
