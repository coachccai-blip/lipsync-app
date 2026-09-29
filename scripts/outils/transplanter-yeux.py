"""
Quand la base d'une marionnette change (ex. nouveaux yeux), toutes les images dérivées de
l'ancienne base (bouches, sourires, mains) portent encore les anciens yeux : le compositeur
verrait alors « un changement » dans la zone des yeux sur chaque bouche. Ce script recopie la
zone modifiée de la nouvelle base dans chaque image dérivée, avec un bord doux.

    python3 scripts/outils/transplanter-yeux.py <ancienne_base.png> <nouvelle_base.png> <image1.png> [image2.png …]

Les images sont modifiées sur place. Dépendances : numpy, Pillow.
"""
import sys
import numpy as np
from PIL import Image, ImageFilter

old = np.asarray(Image.open(sys.argv[1]).convert("RGBA")).astype(np.float32)
new = np.asarray(Image.open(sys.argv[2]).convert("RGBA")).astype(np.float32)
diff = np.abs(new[..., :3] - old[..., :3]).max(axis=2)
core = (diff > 40).astype(np.uint8) * 255
m = Image.fromarray(core).filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(15)).filter(ImageFilter.GaussianBlur(4))
alpha = np.asarray(m).astype(np.float32) / 255
for p in sys.argv[3:]:
    img = np.asarray(Image.open(p).convert("RGBA")).astype(np.float32)
    out = img * (1 - alpha[..., None]) + new * alpha[..., None]
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(p)
    print("yeux transplantés :", p)
