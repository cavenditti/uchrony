# Places, histories and model assignments

Open **Places** in the header for the searchable atlas. It includes natural features, settlements, states, public organizations, current and former leaders, firms, banks, cultural works, beliefs and remembered sites. Search includes saved former and alternative names. A dossier shows relationships, observations, a durable timeline and optional model-written accounts. The locate button frames the recorded map position.

Open **World menu → Model assignments** for the default **Simplified** view: two model choices, each with at most eight recommended options. **Advanced** retains independent assignments for all twelve tasks, the model catalog, provider priorities, measurements and generation limits.

| Simplified choice | Assigned tasks |
| --- | --- |
| Lightweight model | Names, naming traditions, descriptions, imagined traditions, local reports, event expansions, routine government decisions |
| Strong model | Local histories, historian questions, historical developments, strategic reviews, diplomatic settlements |

Switching views never changes assignments. Changing a simplified choice updates only that group's model, preserving every provider priority, background setting and limit. Custom groups appear as custom rather than pretending to use one model. A simplified save requires a compatible selection for both groups; Advanced can retain existing models outside the recommendations. Existing saved settings are preserved, while fresh defaults use the two groups (subject to explicit environment overrides).

Both groups default to free OpenRouter variants: **Gemma 4 26B A4B (free)** for lightweight work and **Nemotron 3.5 Super VL (free)** for strong work. Gemma's smaller active model is suited to frequent naming and short text; Nemotron provides greater capacity and a longer context for histories and decisions. These are workload-fit choices based on [Gemma's provider listing](https://openrouter.ai/google/gemma-4-26b-a4b-it:free), [Nemotron's provider listing](https://openrouter.ai/nvidia/nemotron-3.5-super-vl:free) and the [live catalog](https://openrouter.ai/api/v1/models), checked on 2026-10-27, not an application benchmark. All default roles remain on `:free` IDs, including format repairs; there is no automatic paid-model fallback. Free endpoints can be rate-limited or unavailable. JSON-only models receive the task schema in the prompt without first spending a call on unsupported schema enforcement.

Each curated list now contains seven choices, with its free default first. Paid alternatives remain explicit choices: lightweight — Ministral 3 8B, Mistral Small 4, Gemini 3.1 Flash Lite, Qwen3.8 Flash, Claude Haiku 5.5 and GPT-6 Luna; strong — DeepSeek V4.1 Flash, DeepSeek V4 Pro, Mistral Large 4, GPT-6.1 Terra, GPT-6 Sol and Claude Sonnet 4.6. Those alternatives were checked against the catalog and [OpenAI model guidance](https://developers.openai.com/api/docs/models).

At display time, recommendations are intersected with the live catalog and require JSON or structured output, sufficient known output capacity for every assigned task, and at least 32,768 context tokens for lightweight work or 65,536 for strong work. Models requiring reasoning are excluded because the current dispatcher disables reasoning. Missing candidates are omitted; an unavailable shortlist directs users to Advanced or to reload the catalog. No arbitrary low-price model is automatically promoted into a recommendation.

The live OpenRouter catalog supplies advertised JSON/structured-output support, context/output capacity and token prices. In Advanced, provider priority can favor price, first-response latency or generation throughput. Observed average completion time, overall output tokens per second, failures and provider-reported cost are session measurements, not benchmark claims or pure decoding throughput.

Assignments persist on the local server in `.uchrony/model-settings.json`, separately from worlds and credentials. Environment defaults still apply before a saved configuration exists; `OPENROUTER_WRITING_MODEL` supplies the initial writer. Existing settings win on subsequent server starts. Model changes apply to new requests, and open tabs receive updated settings. Changing assignments never enables model permission. The existing global LLM switch and server override govern every new role and retry.

## Persistence and sources

`src/sim/almanac.ts` registers deterministic geographic and social identities. `src/sim/event-memory.ts` preserves public events before the recent 240-entry feed is trimmed. The permanent archive retains compact dated facts and entity references. Cities also record significant population changes, changes in control, mergers, abandonment and local-language variants. Existing city IDs, ancestry and former names remain authoritative. Firms and leaders retain identities across status changes; cultural works remain in the atlas after the recent legacy list rotates.

Named rivers follow connected downstream paths, keeping tributaries distinct at confluences. Forests, mountain regions, landmasses and seas use connected terrain components. Peaks are spaced local maxima; passes, inlets and straits use coarse terrain classifications. Geography is stable across political changes and adaptive-grid refinement. These classifications are synthetic cartography, not geological surveying. The terrain elevation index is not a height in metres.

All accepted names, aliases, language vocabularies, accounts and source links travel with saves. Geographic geometry stays in the simulation worker. Regular display snapshots carry bounded label records, while dossiers are requested separately. The archive is not copied into every frame. New save validation checks IDs, coordinates, source references, bounded text and record structure. A legacy save gains an atlas during worker initialization; its surviving recent records are recovered, but already-discarded events cannot be reconstructed.

Initial observation, recovered legacy evidence, recorded developments, prose interpretation and imagined tradition are distinct. A place's first atlas date is not its founding date. Province-level events remain labeled as surrounding evidence rather than being silently assigned to a particular town or mountain. Remembered conflict locations use province anchors where the event lacks an exact location. An abandoned settlement entry does not establish how much masonry remains standing.

## Writing and scheduling

New names use deterministic language-family vocabularies while models are unavailable. Background enrichment develops reusable naming vocabularies and batches up to twenty pending names in one language. Accepted names preserve earlier labels. Names are data; this system never draws from the simulation's random stream. Existing leaders can receive new names without regenerating their temperament or skills.

Institution names receive a separate review after founding, admission, departure, expulsion, charter amendment, succession, crisis, reinstatement or recovery. The lightweight **Names** assignment reviews up to six bodies per request before routine atlas enrichment, using the same background-writing cadence, permission switch and call limit. It can retain an appropriate name, but cannot include departed, suspended or nonmember states. A saved review cursor prevents repeated requests for unchanged institutions, including after reload; older saves are checked from their existing journals. Explicit council renames settle the current review, notice of a future withdrawal waits for actual departure, and ordinary defense bookkeeping does not trigger reviews. Dissolved institutions retain their final names. Replies overtaken by another constitutional change are discarded. Accepted renames preserve institution IDs, powers, money, membership and earlier dated names; public atlas entries keep former aliases, and confidential bodies are reviewed in separate batches without entering the public atlas.

Longer descriptions, local histories, reports, traditions and historian answers are requested from a dossier. Prompts contain compact selected facts, neighboring identities and an explicit date. Accounts are saved with source IDs, model provenance and their as-of month. Historical prose cannot apply effects. Local traditions are marked as imagined and never become evidence for subsequent historical answers. Output validation checks source membership and structure; semantic faithfulness still depends on model quality and should be evaluated with real provider outputs.

Historical-event generation remains a separate role with its existing declarative effect validation. Simulation rules continue to govern populations, production, conquest, construction and institutions. Naming or describing a building does not build it. No new pilgrimage, festival, household or individual-agent behavioral model is implied by an atlas account.

All writing uses the existing asynchronous four-job worker scheduler and the server permission barrier. Explicit requests have priority; background enrichment receives a timed opportunity before routine decisions so a large number of governments cannot starve it. Background cadence is measured in real seconds, independently of playback speed. Each task has a bounded output size. The shared server-session call limit counts provider attempts including repairs and failed calls, resets at server restart, and can be changed in settings. It is a request limit, not a guaranteed dollar ceiling. Provider prices and response lengths determine spending.

## Validation

Focused checks:

```sh
node --import tsx --test --test-concurrency=2 tests/almanac.test.ts tests/model-assignments.test.ts tests/llm-policy.test.ts tests/history-targets.test.ts tests/history-variety.test.ts tests/narrative.test.ts tests/view-storage.test.ts tests/playback.test.ts
npm run build
```

The browser fixture uses the production worker, model middleware and UI with deterministic mock provider responses. It cannot call live model providers, and has isolated in-memory model assignments:

```sh
npx vite build --config tests/browser/almanac.config.ts
npx vite preview --config tests/browser/almanac.config.ts
```

Open `http://127.0.0.1:5202/tests/browser/almanac.html`. The fixture distinguishes model response delivery from prose-quality evaluation. No paid model benchmark is included.

Provider contract references: [model catalog](https://openrouter.ai/docs/api/api-reference/models/get-models), [provider selection](https://openrouter.ai/docs/guides/routing/provider-selection).
