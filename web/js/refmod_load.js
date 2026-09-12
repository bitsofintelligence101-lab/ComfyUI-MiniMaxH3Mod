// MiniMaxH3Mod — per-slot ".safetensors file" load widget for the RefMod loaders.
//
// Each mod slot is a plain STRING value on the backend (the uploaded file's
// name, resolved from input/ at run time — no mods-folder dropdown). This
// extension replaces that hidden string with an image-style file row: a
// read-only filename box plus a "choose file" button. Picking a file uploads
// it to /minimaxh3mod/upload (saved into input/) and stores the returned
// filename in the widget, exactly like LoadImage stores an uploaded image.
import { app } from "../../../scripts/app.js";

const LOADER_NODES = new Set(["MiniMaxH3RefModsLoader", "MiniMaxH3RefModsAxis", "MiniMaxH3RefModSingle"]);
// slot value widgets: mod_1..mod_8 (loader), mod_a_1/mod_b_1.. (axis), mod (single)
const MOD_WIDGET = /^mod(?:_(?:[ab]_)?\d+)?$/;

function uploadRefMod(file) {
    const body = new FormData();
    body.append("file", file, file.name);
    return fetch("/minimaxh3mod/upload", { method: "POST", body })
        .then(async (r) => {
            const data = await r.json().catch(() => ({}));
            if (r.ok && data && data.name) return data.name;
            throw new Error((data && data.error) || ("HTTP " + r.status));
        });
}

// Build the visible DOM row for one slot and wire it to the hidden string
// widget that carries the value into the workflow.
function attachFileRow(node, valueWidget) {
    // Hide the raw string row visually but keep it in the widgets array. The
    // UI serializer binds widget values to backend inputs POSITIONALLY, so the
    // array order must stay exactly the backend INPUT_TYPES order — only the
    // row's own DOM is hidden. The DOM file row below is inserted in place of
    // it, so the visible layout is unchanged.
    const row = document.createElement("div");
    row.style.cssText =
        "display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;padding:0 4px;";

    const label = document.createElement("span");
    label.style.cssText =
        "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" +
        "font-size:11px;color:#9aa;text-align:left;";
    label.title = "No RefMod loaded";

    const btn = document.createElement("button");
    btn.textContent = "load";
    btn.title = "Load a .safetensors RefMod file (uploaded into input/)";
    btn.style.cssText =
        "flex:none;font-size:11px;padding:2px 8px;cursor:pointer;border-radius:4px;" +
        "border:1px solid #456;background:#2a3340;color:#dde;";

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".safetensors";
    fileInput.style.display = "none";

    const clear = document.createElement("button");
    clear.textContent = "x";
    clear.title = "Clear this slot";
    clear.style.cssText =
        "flex:none;font-size:11px;padding:2px 6px;cursor:pointer;border-radius:4px;" +
        "border:1px solid #544;background:#3a2a2a;color:#dcc;";

    function refresh() {
        const v = valueWidget.value;
        const has = typeof v === "string" && v.length > 0;
        label.textContent = has ? v.split(/[\\/]/).pop() : "(no refmod)";
        label.title = has ? v : "No RefMod loaded";
        clear.style.visibility = has ? "visible" : "hidden";
    }

    btn.addEventListener("click", () => fileInput.click());
    clear.addEventListener("click", () => {
        valueWidget.value = "";
        refresh();
        node.setDirtyCanvas(true, true);
    });
    fileInput.addEventListener("change", async () => {
        const file = fileInput.files && fileInput.files[0];
        fileInput.value = "";
        if (!file) return;
        btn.disabled = true;
        const old = btn.textContent;
        btn.textContent = "…";
        try {
            const name = await uploadRefMod(file);
            valueWidget.value = name;
            refresh();
            node.setDirtyCanvas(true, true);
        } catch (e) {
            console.warn("[MiniMaxH3Mod] RefMod upload failed:", e);
            alert("RefMod upload failed: " + e.message);
        } finally {
            btn.disabled = false;
            btn.textContent = old;
        }
    });

    row.append(label, btn, clear, fileInput);

    // The DOM row is only a controller: it never serializes. The real
    // (hidden) value widget keeps its own name and value, so ComfyUI's
    // serializer writes it into the workflow exactly as headless does. This
    // avoids "Required input is missing: mod_n" in the UI while staying
    // identical to the headless path.
    const dom = node.addDOMWidget(valueWidget.name + "$file", "refmodFile", row, {
        getValue: () => valueWidget.value,
        setValue: (v) => { valueWidget.value = v; refresh(); },
    });
    dom.serializeValue = () => undefined;

    // keep the row in sync if the value is restored from a saved workflow
    const origCb = valueWidget.callback;
    valueWidget.callback = function () {
        refresh();
        if (origCb) origCb.apply(valueWidget, arguments);
    };
    refresh();

    // Collapse the raw widget's rendered row (it stays in node.widgets so
    // positional serialization is preserved). Replace the DOM file row into
    // the same visual slot.
    if (valueWidget.element) {
        valueWidget.element.style.display = "none";
    }
    valueWidget.computeSize = () => [0, -4];
}

app.registerExtension({
    name: "MiniMaxH3Mod.RefModLoad",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (!LOADER_NODES.has(nodeData.name)) return;
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
            // Attach a file row per mod slot, then rebuild node.widgets with
            // each DOM row inserted right after its own value widget. The UI
            // serializer binds widget values to backend inputs POSITIONALLY,
            // so the relative order of the VALUE widgets is left exactly as
            // the backend INPUT_TYPES declared it — but addDOMWidget APPENDS
            // the DOM row at the end, which would make the array longer than
            // the input list and shift every value after it by one slot
            // (on the single-slot node the filename lands in show_info and is
            // never saved under 'mod'). Inserting the DOM rows inline keeps
            // every input's value in its declared position.
            for (const w of this.widgets ?? []) {
                if (MOD_WIDGET.test(w.name)) attachFileRow(this, w);
            }
            const doms = new Set((this.widgets ?? []).filter((w) => w.type === "refmodFile"));
            if (doms.size) {
                const rebuilt = [];
                for (const w of this.widgets) {
                    if (doms.has(w)) continue;
                    rebuilt.push(w);
                    if (MOD_WIDGET.test(w.name)) {
                        const dom = this.widgets.find((d) => doms.has(d) && d.name === w.name + "$file");
                        if (dom) rebuilt.push(dom);
                    }
                }
                this.widgets.length = 0;
                this.widgets.push(...rebuilt);
                this.setSize(this.computeSize());
            }
            return r;
        };
    },
});
