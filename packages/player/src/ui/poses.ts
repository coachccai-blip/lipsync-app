import { ARKIT_BLENDSHAPES, type AllConfig, type MorphWeights, type RhubarbShape } from "@avatar/shared";
import { clear, h, icon } from "./dom.js";

export interface PoseEditorCallbacks {
  /** Aperçu : pose forcée sur le modèle (null = retour à l'animation). */
  onPreview(morphs: MorphWeights | null): void;
  onChange(file: "emotions" | "visemes"): void;
  onSave(file: "emotions" | "visemes"): void;
}

const SHAPE_HINTS: Record<RhubarbShape, string> = {
  X: "repos", A: "M, B, P (bouche fermée)", B: "K, S, T (dents serrées)", C: "È, É", D: "A grand ouvert", E: "O ouvert", F: "OU, U, W", G: "F, V", H: "L",
};

const GROUPS: { title: string; test: (n: string) => boolean }[] = [
  { title: "Mâchoire et bouche", test: (n) => n.startsWith("jaw") || n.startsWith("mouth") || n === "tongueOut" },
  { title: "Sourcils", test: (n) => n.startsWith("brow") },
  { title: "Yeux", test: (n) => n.startsWith("eye") },
  { title: "Joues et nez", test: (n) => n.startsWith("cheek") || n.startsWith("nose") },
];

/**
 * Éditeur de poses : sélectionne une émotion (config/emotions.json) ou une forme de bouche
 * (config/visemes.json) et règle chaque blendshape ARKit au curseur, avec aperçu immédiat.
 */
export class PoseEditor {
  private target: { file: "emotions"; name: string } | { file: "visemes"; name: RhubarbShape } = { file: "emotions", name: "enjoué" };
  private preview = true;
  private showAll = false;

  constructor(private readonly cb: PoseEditorCallbacks) {}

  private pose(cfg: AllConfig): MorphWeights {
    if (this.target.file === "emotions") return (cfg.emotions.emotions[this.target.name] ??= {});
    return (cfg.visemes.shapes[this.target.name] ??= {});
  }

  stopPreview(): void {
    this.cb.onPreview(null);
  }

  private updatePreview(cfg: AllConfig): void {
    this.cb.onPreview(this.preview ? { ...this.pose(cfg) } : null);
  }

  render(el: HTMLElement, cfg: AllConfig): void {
    clear(el);
    const emotions = Object.keys(cfg.emotions.emotions);
    const emoSelect = h("select", null, ...emotions.map((n) => h("option", { value: n, selected: this.target.file === "emotions" && this.target.name === n }, n)));
    const shapes = Object.keys(cfg.visemes.shapes) as RhubarbShape[];
    const shapeSelect = h("select", null, ...shapes.map((n) => h("option", { value: n, selected: this.target.file === "visemes" && this.target.name === n }, `${n} — ${SHAPE_HINTS[n] ?? ""}`)));
    emoSelect.onchange = () => {
      this.target = { file: "emotions", name: emoSelect.value };
      this.render(el, cfg);
    };
    shapeSelect.onchange = () => {
      this.target = { file: "visemes", name: shapeSelect.value as RhubarbShape };
      this.render(el, cfg);
    };
    const previewCb = h("input", { type: "checkbox", checked: this.preview });
    previewCb.onchange = () => {
      this.preview = previewCb.checked;
      this.updatePreview(cfg);
    };
    const showAllCb = h("input", { type: "checkbox", checked: this.showAll });
    showAllCb.onchange = () => {
      this.showAll = showAllCb.checked;
      this.render(el, cfg);
    };
    const newEmotion = h("button.small", { onclick: () => {
      const name = prompt("Nom de la nouvelle émotion (minuscules, sans espace) :", "");
      if (!name) return;
      const key = name.trim().toLowerCase().replace(/\s+/g, "_");
      if (cfg.emotions.emotions[key]) return;
      cfg.emotions.emotions[key] = {};
      this.target = { file: "emotions", name: key };
      this.cb.onChange("emotions");
      this.render(el, cfg);
    } }, icon("plus", 14), "Émotion");
    el.append(
      h("p.hint", null, "Choisissez une émotion ou une forme de bouche, puis réglez ses blendshapes. L'aperçu fige la pose sur le modèle ; décochez-le pour revoir l'animation."),
      h("div.controls", null,
        h("label.control", null, h("span", null, "Émotion"), h("div.row", { style: { margin: 0 } }, emoSelect, newEmotion)),
        h("label.control", null, h("span", null, "Forme de bouche (Rhubarb)"), shapeSelect),
      ),
      h("div.row", null, h("label", null, previewCb, " aperçu de la pose"), h("label", null, showAllCb, " afficher les 52 blendshapes")),
    );
    const pose = this.pose(cfg);
    const title = this.target.file === "emotions" ? `Émotion « ${this.target.name} »` : `Forme ${this.target.name}`;
    el.append(h("h3", null, title));
    if (this.target.file === "emotions" && this.target.name === "neutre") el.append(h("p.hint", null, "« neutre » est la pose de repos : laissez-la vide."));
    for (const g of GROUPS) {
      const names = ARKIT_BLENDSHAPES.filter((n) => g.test(n) && (this.showAll || (pose[n] ?? 0) > 0));
      if (!names.length) continue;
      const controls = h("div.controls");
      for (const n of names) {
        const r = h("input", { type: "range", min: 0, max: 1, step: 0.01, value: pose[n] ?? 0 });
        const out = h("output", null, (pose[n] ?? 0).toFixed(2));
        r.oninput = () => {
          const v = Number(r.value);
          if (v <= 0) delete pose[n];
          else pose[n] = v;
          out.textContent = v.toFixed(2);
          this.cb.onChange(this.target.file);
          this.updatePreview(cfg);
        };
        controls.appendChild(h("label.control", null, h("span", null, n), h("div.range", null, r, out)));
      }
      el.append(h("details.section", { open: true }, h("summary", null, g.title), h("div.body", null, controls)));
    }
    if (!this.showAll && Object.keys(pose).length === 0) el.append(h("p.hint", null, "Pose vide : cochez « afficher les 52 blendshapes » pour en ajouter."));
    el.append(
      h("div.row", null,
        h("button.primary", { onclick: () => this.cb.onSave(this.target.file) }, icon("save", 14), `Enregistrer config/${this.target.file}.json`),
        h("button.danger", { onclick: () => {
          for (const k of Object.keys(pose)) delete pose[k];
          this.cb.onChange(this.target.file);
          this.render(el, cfg);
          this.updatePreview(cfg);
        } }, icon("trash", 14), "Vider la pose"),
      ),
    );
    this.updatePreview(cfg);
  }
}
