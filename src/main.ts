import "./style.css";
import {
  startCheckIn,
  submitReturn,
  applyInterpretation,
  markSkipped,
  humanConfirm,
  describeState,
  type CheckInDraft,
  type Receipt,
} from "./receipt";
import { MODELS, loadModel, interpret, loadedModelId, loadedLowMemory } from "./llm";
import { metricsDocument } from "./engine-options";
import { putReceipt, allReceipts, putMetric, allMetrics } from "./store";

const DEFAULT_NOTE =
  "46 minutes. About 3 miles. Wind picked up halfway through. Finished the entire route.";

const app = document.getElementById("app")!;
app.innerHTML = `
  <h1>Field Receipt</h1>
  <p class="sub">Go do the thing. Come back. Say what happened. Gemma writes it down; you decide what it means.</p>

  <section id="device"><h2>Device</h2><div class="row" id="deviceRows">checking…</div></section>

  <section>
    <h2>Model</h2>
    <select id="model">${MODELS.map((m) => `<option value="${m.id}">${m.label}</option>`).join("")}</select>
    <label class="check"><input id="lowMemory" type="checkbox" /> Low-memory mode</label>
    <p class="note">When checked, the next load uses a 1024-token context window. Load the model again after changing this.</p>
    <button id="load" class="primary">Load model</button>
    <progress id="prog" value="0" max="1" hidden></progress>
    <p class="note" id="loadStatus">Not loaded. First load downloads weights over the network, then they are cached on this device.</p>
  </section>

  <section>
    <h2>Check-in</h2>
    <button id="start">Start — leaving now</button>
    <p class="note" id="startStatus">Not started. Putting the phone away is the point.</p>
    <textarea id="note"></textarea>
    <button id="submit" class="primary">Submit return</button>
  </section>

  <section>
    <h2>Receipts</h2>
    <div id="receipts"><p class="note">None yet.</p></div>
  </section>

  <section>
    <h2>Metrics</h2>
    <button id="copyMetrics">Copy metrics JSON</button>
    <pre id="metrics">—</pre>
  </section>
`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
$<HTMLTextAreaElement>("note").value = DEFAULT_NOTE;

let draft: CheckInDraft | null = null;
let deviceInfo: Record<string, unknown> = {};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// ---------- device check ----------
async function deviceCheck() {
  const info: Record<string, unknown> = {
    secure_context: window.isSecureContext,
    webgpu: "gpu" in navigator,
    shader_f16: false,
    max_buffer_mb: null,
    architecture: null,
    storage_persisted: null,
    storage_quota_mb: null,
    user_agent: navigator.userAgent,
  };
  try {
    const gpu = (navigator as Navigator & { gpu?: any }).gpu;
    const adapter = gpu ? await gpu.requestAdapter() : null;
    if (adapter) {
      info.shader_f16 = adapter.features.has("shader-f16");
      info.max_buffer_mb = Math.round(adapter.limits.maxBufferSize / 1048576);
      info.architecture = adapter.info?.architecture ?? null;
    } else info.webgpu = false;
  } catch (e) {
    info.gpu_error = String(e);
  }
  try {
    info.storage_persisted = (await navigator.storage?.persist?.()) ?? null;
    const est = await navigator.storage?.estimate?.();
    if (est?.quota) info.storage_quota_mb = Math.round(est.quota / 1048576);
  } catch {
    /* storage API optional */
  }
  deviceInfo = info;
  const row = (k: string, ok: boolean | null, v: string) =>
    `<span>${k}</span><span class="${ok === null ? "" : ok ? "pass" : "fail"}">${esc(v)}</span>`;
  $("deviceRows").innerHTML = [
    row("HTTPS / secure context", !!info.secure_context, String(info.secure_context)),
    row("WebGPU", !!info.webgpu, String(info.webgpu)),
    row("shader-f16", !!info.shader_f16, String(info.shader_f16)),
    row("max buffer (MB)", null, String(info.max_buffer_mb ?? "n/a")),
    row("GPU arch", null, String(info.architecture ?? "n/a")),
    row("storage persisted", null, String(info.storage_persisted ?? "n/a")),
    row("storage quota (MB)", null, String(info.storage_quota_mb ?? "n/a")),
  ].join("");
}

// ---------- metrics ----------
async function renderMetrics() {
  const m = await allMetrics();
  const lowMemory = $<HTMLInputElement>("lowMemory").checked;
  $("metrics").textContent = JSON.stringify(metricsDocument(deviceInfo, m, lowMemory), null, 2);
}

$("copyMetrics").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("metrics").textContent ?? "");
    $("copyMetrics").textContent = "Copied";
  } catch {
    $("copyMetrics").textContent = "Copy failed — select the text manually";
  }
});

// ---------- model ----------
$("lowMemory").addEventListener("change", () => {
  if (loadedModelId() && $<HTMLInputElement>("lowMemory").checked !== loadedLowMemory()) {
    $("loadStatus").textContent = "Low-memory mode changed. Press Load model to apply it.";
  }
});

$("load").addEventListener("click", async () => {
  const id = $<HTMLSelectElement>("model").value;
  const lowMemory = $<HTMLInputElement>("lowMemory").checked;
  const btn = $<HTMLButtonElement>("load");
  const prog = $<HTMLProgressElement>("prog");
  btn.disabled = true;
  prog.hidden = false;
  $("loadStatus").textContent = "Loading…";
  const t0 = performance.now();
  const tick = setInterval(() => {
    $("loadStatus").dataset.elapsed = String(Math.round((performance.now() - t0) / 1000));
  }, 1000);
  try {
    const { seconds } = await loadModel(id, (text, frac) => {
      prog.value = frac;
      $("loadStatus").textContent = `${text} (${Math.round((performance.now() - t0) / 1000)}s)`;
    }, lowMemory);
    const mode = lowMemory ? " (low-memory mode, 1024-token context)" : "";
    $("loadStatus").textContent = `Loaded ${id} in ${seconds.toFixed(1)}s${mode}.`;
    await putMetric({ kind: "load", at: new Date().toISOString(), model: id, low_memory: lowMemory, load_seconds: Number(seconds.toFixed(2)), ok: true });
  } catch (e) {
    $("loadStatus").textContent = `Load failed: ${String(e)}`;
    await putMetric({ kind: "load", at: new Date().toISOString(), model: id, low_memory: lowMemory, ok: false, error: String(e) });
  } finally {
    clearInterval(tick);
    btn.disabled = false;
    await renderMetrics();
  }
});

// ---------- check-in ----------
$("start").addEventListener("click", () => {
  draft = startCheckIn(new Date());
  $("startStatus").textContent = `Started ${new Date(draft.claimed_start).toLocaleTimeString()}. Go. Come back and write what happened.`;
});

async function runInterpretation(r: Receipt): Promise<Receipt> {
  const note = r.evidence[0].text;
  if (!loadedModelId()) {
    const skipped = markSkipped(r, "model not loaded");
    await putReceipt(skipped);
    return skipped;
  }
  const model = loadedModelId()!;
  const lowMemory = loadedLowMemory();
  try {
    const res = await interpret(note);
    // Persist raw timing BEFORE judging the output.
    await putMetric({
      kind: "infer",
      at: new Date().toISOString(),
      model,
      low_memory: lowMemory,
      receipt_id: r.receipt_id,
      elapsed_ms: Math.round(res.elapsed_ms),
      completion_tokens: res.completion_tokens,
      tokens_per_s: res.tokens_per_s ? Number(res.tokens_per_s.toFixed(1)) : null,
      raw_output: res.raw,
    });
    const done = applyInterpretation(r, res.raw, model, new Date());
    await putReceipt(done);
    return done;
  } catch (e) {
    await putMetric({ kind: "infer", at: new Date().toISOString(), model, low_memory: lowMemory, receipt_id: r.receipt_id, ok: false, error: String(e) });
    if (!loadedModelId()) $("loadStatus").textContent = "The GPU device was lost, so the model was unloaded. Press Load model, then Interpret with Gemma.";
    const failed = markSkipped(r, `inference error: ${String(e)}`);
    await putReceipt(failed);
    return failed;
  }
}

$("submit").addEventListener("click", async () => {
  const btn = $<HTMLButtonElement>("submit");
  const note = $<HTMLTextAreaElement>("note").value;
  btn.disabled = true;
  try {
    const d = draft ?? startCheckIn(new Date());
    draft = null;
    $("startStatus").textContent = "Not started.";
    const receipt = await submitReturn(d, note, new Date(), {
      device: navigator.userAgent,
      offline: !navigator.onLine,
    });
    await putReceipt(receipt); // claim is saved before any inference
    await renderReceipts();
    await runInterpretation(receipt);
  } catch (e) {
    alert(String(e));
  } finally {
    btn.disabled = false;
    await renderReceipts();
    await renderMetrics();
  }
});

// ---------- receipts ----------
async function renderReceipts() {
  const list = await allReceipts();
  const box = $("receipts");
  if (!list.length) {
    box.innerHTML = `<p class="note">None yet.</p>`;
    return;
  }
  box.innerHTML = list
    .map((r) => {
      const confirmed = r.verification.state === "HUMAN_CONFIRMED";
      const x = r.ai.extraction;
      return `<div class="receipt" data-id="${r.receipt_id}">
        <span class="badge ${confirmed ? "confirmed" : ""}">${esc(describeState(r))}</span>
        <p class="note">${esc(r.evidence[0].text)}</p>
        <p>${
          x
            ? `<strong>${esc(x.activity)}</strong> · ${x.duration_minutes ?? "?"} min · ${x.distance_miles ?? "?"} mi · complete: ${x.claimed_complete ?? "not stated"}`
            : `AI: ${r.ai.status}${r.ai.error ? " — " + esc(r.ai.error) : ""}`
        }</p>
        ${x && x.observations.length ? `<p class="note">Noticed: ${esc(x.observations.join("; "))}</p>` : ""}
        ${x && x.exceptions.length ? `<p class="note">Exceptions: ${esc(x.exceptions.join("; "))}</p>` : ""}
        <p class="note">Missing: ${esc(r.verification.missing.join(", "))}</p>
        ${confirmed ? "" : `<button data-act="confirm">I confirm this is what I did</button>`}
        ${r.ai.status !== "OK" && loadedModelId() ? `<button data-act="retry">Interpret with Gemma</button>` : ""}
        <details><summary>Raw receipt</summary><pre>${esc(JSON.stringify(r, null, 2))}</pre></details>
      </div>`;
    })
    .join("");
}

$("receipts").addEventListener("click", async (ev) => {
  const btn = (ev.target as HTMLElement).closest("button[data-act]") as HTMLButtonElement | null;
  if (!btn) return;
  const id = btn.closest<HTMLElement>(".receipt")!.dataset.id!;
  const r = (await allReceipts()).find((x) => x.receipt_id === id);
  if (!r) return;
  btn.disabled = true;
  if (btn.dataset.act === "confirm") await putReceipt(humanConfirm(r, new Date()));
  if (btn.dataset.act === "retry") await runInterpretation(r);
  await renderReceipts();
  await renderMetrics();
});

await deviceCheck();
await renderReceipts();
await renderMetrics();
