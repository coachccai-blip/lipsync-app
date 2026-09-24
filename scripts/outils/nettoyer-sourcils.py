"""
Nettoyage des images de sourcils (sourcils_leves.png, sourcils_fronces.png) : reconstruit chaque
image comme la base sans ses sourcils (remplissage par la peau) + uniquement les nouveaux sourcils
(pixels sombres, hors cheveux). À lancer depuis la racine du dépôt sur les images ORIGINALES
générées par ChatGPT, après les avoir déposées dans assets/marionnette/ :

    python3 scripts/outils/nettoyer-sourcils.py

Dépendances : numpy, Pillow.
"""
import numpy as np
from PIL import Image, ImageFilter
base = np.asarray(Image.open("assets/marionnette/base.png").convert("RGBA")).astype(np.float32)
luma = lambda a: 0.299*a[...,0]+0.587*a[...,1]+0.114*a[...,2]
lb = luma(base); H, W = lb.shape
X0, X1, Y0, Y1 = 400, 850, 250, 484
SKIN = 150

def grow(seed, allowed, n=400):
    for it in range(n):
        g = seed.copy()
        g[1:] |= seed[:-1]; g[:-1] |= seed[1:]; g[:, 1:] |= seed[:, :-1]; g[:, :-1] |= seed[:, 1:]
        g &= allowed
        if (g == seed).all(): break
        seed = g
    return seed
def dil(m, k):
    return np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(k))).astype(bool)

# cheveux : cœur très sombre connecté à la masse au-dessus des sourcils
# cheveux : sombres ET peu rougeâtres (les sourcils sont plus clairs et plus chauds : R-B ≈ 25 contre ≈ 10)
hairlike = (lb < 58) & ((base[..., 0] - base[..., 2]) < 18)
hair_core = grow(np.vstack([hairlike[:300], np.zeros((H - 300, W), bool)]), hairlike)
hair_keep = dil(hair_core, 13)     # zone conservée telle quelle (mèche et son ombre, bout de sourcil dessous)

# sourcils de la base : pixels sombres dans la bande, hors zone cheveux, dilatés
zone = np.zeros((H, W), bool); zone[370:480, X0:X1] = True
brow = dil((lb < SKIN) & zone, 9)

# remplissage : interpolation verticale entre peaux, puis lissage local qui ignore les pixels sombres
skin = base.copy()
ys, xs = np.where(brow); y0, y1, x0, x1 = ys.min() - 24, ys.max() + 25, xs.min() - 24, xs.max() + 25
sub = skin[y0:y1, x0:x1, :3].copy(); lsub = lb[y0:y1, x0:x1]
# domaine à remplir : sourcils ET tout ce qui est sombre dans le rectangle (mèche de cheveux
# comprise) ; la mèche est redessinée ensuite par-dessus, avec un bord doux
m = brow[y0:y1, x0:x1] | (lsub < SKIN)
m[:8] = False; m[-8:] = False; m[:, :8] = False; m[:, -8:] = False   # jamais au bord du rectangle (voisinage tronqué)
ok_row = lambda y: (lsub[y] >= SKIN) & ~m[y]
for x in range(sub.shape[1]):
    col = np.where(m[:, x])[0]
    if len(col) == 0: continue
    for g in np.split(col, np.where(np.diff(col) > 1)[0] + 1):
        a, b = g.min(), g.max()
        ta = a - 1
        while ta >= 0 and (lsub[ta, x] < SKIN or m[ta, x]): ta -= 1
        tb = b + 1
        while tb < sub.shape[0] and (lsub[tb, x] < SKIN or m[tb, x]): tb += 1
        if tb >= sub.shape[0]: continue
        bot = sub[tb, x].copy()
        if ta < 0:
            # pas de peau au-dessus (mèche de cheveux) : peau du dessous, ou peau la plus proche
            # à gauche / droite sur la même ligne
            for y in range(a, b + 1):
                row = np.where(ok_row(y))[0]
                sub[y, x] = bot if len(row) == 0 else sub[y, row[np.argmin(np.abs(row - x))]]
            continue
        top = sub[ta, x].copy()
        for y in range(a, b + 1):
            t = (y - ta) / (tb - ta)
            sub[y, x] = top * (1 - t) + bot * t
ok = m | (lsub >= SKIN)   # pixels utilisables comme voisins : remplis ou peau
okf = ok.astype(np.float32)[..., None]
for it in range(60):
    num = np.zeros_like(sub); den = np.zeros_like(okf)
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        num += np.roll(sub * okf, (dy, dx), (0, 1)); den += np.roll(okf, (dy, dx), (0, 1))
    avg = num / np.maximum(den, 1)
    upd = m & (den[..., 0] > 0)
    sub[upd] = avg[upd]
skin[y0:y1, x0:x1, :3] = sub
# mèche redessinée : forme réelle (par luminance) limitée au voisinage du cœur des cheveux
hs = np.clip((SKIN - lb) / (SKIN - 50), 0, 1) * dil(hair_core, 5)
hs = np.asarray(Image.fromarray((hs * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))).astype(np.float32) / 255
skin = skin * (1 - hs[..., None]) + base * hs[..., None]


def rebuild(name):
    a = np.asarray(Image.open(f"assets/marionnette/{name}").convert("RGBA")).astype(np.float32)
    la = luma(a)
    dark = np.zeros((H, W), np.uint8)
    z = np.zeros((H, W), bool); z[Y0:Y1, X0:X1] = True
    dark[(la < SKIN) & z] = 255
    mm = Image.fromarray(dark).filter(ImageFilter.MinFilter(17)).filter(ImageFilter.MaxFilter(17)).filter(ImageFilter.MaxFilter(7))
    keep = np.asarray(mm).astype(np.float32) / 255
    alpha = np.clip((SKIN - la) / 40, 0, 1) * keep * (~dil(hair_core, 5))
    alpha = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))).astype(np.float32) / 255
    out = skin * (1 - alpha[..., None]) + a * alpha[..., None]
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(f"assets/marionnette/{name}")
rebuild("sourcils_leves.png"); rebuild("sourcils_fronces.png"); print("ok")
