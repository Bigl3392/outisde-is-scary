# Field Receipt

A local-first evidence layer for physical work. You go do something in the real world, put the phone away, come back, and say what happened in a sentence or two. A small open model (Gemma, running in your browser) turns that into a structured receipt. The receipt keeps four things apart that most apps blur together: **what you claimed, what evidence exists, what the AI interpreted, and what has actually been verified.**

> **SYNTHETIC DATA NOTICE.** All fixtures and demo content in this repository are SYNTHETIC. "Ember & Oak Hospitality Group" and every named person in `fixtures/` are fictional. No real client, employee, or customer data is included.

Built for DEV's Hacktoberfest Open-Source AI Challenge, Week 1: "Touch Grass."

## The one rule

**AI interprets. AI does not certify.**

| State | Meaning | Reachable in this build |
|---|---|---|
| CLAIMED (`SELF_ATTESTED`) | The person said so | yes |
| CLAIM CONFIRMED (`HUMAN_CONFIRMED`) | The person re-read the receipt and stood behind it | yes |
| CORROBORATED / VERIFIED | Someone or something independent agrees | no, and the receipt says so (`missing: independent_corroboration`) |

The model's output is parsed into a fixed schema. Tolerant extraction takes the first complete JSON object out of code fences or surrounding chatter, and the raw model text is stored untouched. The model never changes the verification state or the claim (including timestamps and the hash). Those stay with the deterministic code in `src/receipt.ts`, covered by unit tests.

## Design decisions

- **The raw note is saved before inference.** If the model never loads, crashes, or the browser kills the tab, the claim still exists.
- **Bad model output never destroys a claim.** If Gemma returns invalid JSON, the receipt keeps the raw output and an error, and the claim stands as "valid claim, insufficient interpretation." A fenced or chatty reply can still parse, but `ai.raw_output` remains the exact text the model returned.
- **No grammar-constrained decoding.** The prompt is short and includes one worked example. Generation is capped at 160 tokens and stops on blank-line runs (`\n\n`, and the same gap with spaces). The JSON is checked afterwards by extraction and the zod schema.
- **A lost GPU unloads the model.** If the device is lost during generation, the engine is unloaded and its worker stopped. The page tells you the model was unloaded and to press Load model, then Interpret with Gemma.
- **Event time and processing time are separate.** When you said you left and returned is not when the model ran.
- **Tamper-evident claim.** A SHA-256 over the claim and evidence detects later edits to the note or the claimed times.
- **Why a local open model.** Field notes can carry locations, names, and operational detail. Extraction happens on the device through WebGPU, so those notes are not sent to a hosted AI service.

## Run it

```bash
npm install
npm test          # receipt logic, prompt, fixtures, grep gates
npm run dev       # local dev
npm run build     # static output in dist/
```

Phone WebGPU needs HTTPS, so the demo is deployed as a static site (Cloudflare Pages: build command `npm run build`, output directory `dist`).

Models (via [WebLLM](https://github.com/mlc-ai/web-llm)): Gemma 3 1B primary; Gemma 2 2B fallbacks. Tested target: Android Chrome with WebGPU and `shader-f16`.

## Honest limits

- **Offline is conditional.** The first load downloads model weights over the network. After they are cached on the device, extraction runs without a connection. Browsers can evict caches; the app asks for persistent storage but cannot guarantee it.
- **Small model, checked afterwards.** There is no grammar-constrained decoding. A short prompt with one example, a 160-token generation cap, and stop sequences bound the reply; schema validation judges it. A 1B model can still misread a note; that is why a person confirms the receipt and why the raw note is always kept.
- **Self-attestation is not proof.** This build does not fabricate certainty. Photo, sensor, or second-person corroboration are out of scope here.
- Voice input is not in this version.

## Post-deadline commits

Challenge deadline: October 11, 2026, 11:59 PM PDT. Any commit made after that deadline is listed here.

_None yet._

## Scope

This is a public reference implementation of one idea. It is not part of any larger system.

## License

MIT
