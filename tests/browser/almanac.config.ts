import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { storytellerMiddleware } from '../../server/storyteller'
import { ModelService } from '../../server/model-settings'
import { LlmPolicy } from '../../server/llm-policy'
const root = fileURLToPath(new URL('../..', import.meta.url))
const service = new ModelService()
await service.initialize({})
// All choices and prices here are fixtures. Provider responses below remain mocked.
service.models = [
  {
    id: 'google/gemma-4-26b-a4b-it:free',
    name: 'Google: Gemma 4 26B A4B (free)',
    context: 262144,
    inputPrice: 0,
    outputPrice: 0,
    structured: false,
    json: true,
    outputLimit: 32768,
  },
  {
    id: 'nvidia/nemotron-3.5-super-vl:free',
    name: 'NVIDIA: Nemotron 3.5 Super VL (free)',
    context: 1000000,
    inputPrice: 0,
    outputPrice: 0,
    structured: true,
    json: true,
    outputLimit: 131072,
  },
  {
    id: 'mistralai/ministral-8b-2512',
    name: 'Mistral: Ministral 3 8B 2512',
    context: 131072,
    inputPrice: 0.1,
    outputPrice: 0.5,
    structured: true,
    json: true,
    outputLimit: 16384,
  },
  {
    id: 'mistralai/mistral-small-2603',
    name: 'Mistral: Mistral Small 4',
    context: 131072,
    inputPrice: 0.1,
    outputPrice: 0.5,
    structured: true,
    json: true,
    outputLimit: 16384,
  },
  {
    id: 'google/gemini-3.1-flash-lite',
    name: 'Google: Gemini 3.1 Flash Lite',
    context: 131072,
    inputPrice: 0.1,
    outputPrice: 0.5,
    structured: true,
    json: true,
    outputLimit: 16384,
  },
  {
    id: 'qwen/qwen3.8-flash',
    name: 'Qwen: Qwen3.8 Flash',
    context: 131072,
    inputPrice: 0.1,
    outputPrice: 0.5,
    structured: true,
    json: true,
    outputLimit: 16384,
  },
  {
    id: 'anthropic/claude-haiku-5.5',
    name: 'Anthropic: Claude Haiku 5.5',
    context: 131072,
    inputPrice: 0.1,
    outputPrice: 0.5,
    structured: true,
    json: true,
    outputLimit: 16384,
  },
  {
    id: 'openai/gpt-6-luna',
    name: 'OpenAI: GPT-6 Luna',
    context: 131072,
    inputPrice: 0.1,
    outputPrice: 0.5,
    structured: true,
    json: true,
    outputLimit: 16384,
  },
  {
    id: 'deepseek/deepseek-v4.1-flash',
    name: 'DeepSeek: DeepSeek V4.1 Flash',
    context: 131072,
    inputPrice: 0.1,
    outputPrice: 0.5,
    structured: true,
    json: true,
    outputLimit: 16384,
  },
  {
    id: 'deepseek/deepseek-v4-pro',
    name: 'DeepSeek: DeepSeek V4 Pro 0423',
    context: 131072,
    inputPrice: 0.1,
    outputPrice: 0.5,
    structured: true,
    json: true,
    outputLimit: 16384,
  },
  {
    id: 'mistralai/mistral-large-4-0',
    name: 'Mistral: Mistral Large 4',
    context: 131072,
    inputPrice: 0.1,
    outputPrice: 0.5,
    structured: true,
    json: true,
    outputLimit: 16384,
  },
  {
    id: 'openai/gpt-6.1-terra',
    name: 'OpenAI: GPT-6.1 Terra',
    context: 131072,
    inputPrice: 0.1,
    outputPrice: 0.5,
    structured: true,
    json: true,
    outputLimit: 16384,
  },
  {
    id: 'openai/gpt-6-sol',
    name: 'OpenAI: GPT-6 Sol',
    context: 131072,
    inputPrice: 0.1,
    outputPrice: 0.5,
    structured: true,
    json: true,
    outputLimit: 16384,
  },
  {
    id: 'anthropic/claude-sonnet-4.6',
    name: 'Anthropic: Claude Sonnet 4.6',
    context: 131072,
    inputPrice: 0.1,
    outputPrice: 0.5,
    structured: true,
    json: true,
    outputLimit: 16384,
  },
]
service.refreshCatalog = async () => {}
const config = service.snapshot().settings
config.backgroundWriting = false
await service.update(config)
const policy = new LlmPolicy(() => false)
process.env.OPENROUTER_API_KEY = 'qualification-stub-no-external-access'
const middleware = storytellerMiddleware(
  'test',
  policy,
  async (_url, init) => {
    const request = JSON.parse(init!.body as string),
      context = JSON.parse(request.messages[1].content).context
    const proposal =
      context.task === 'naming'
        ? {
            names: context.targets.map((t: any, i: number) => ({
              id: t.id,
              name: `Velorin ${i + 1}`,
              reason: 'A shared fictional language root.',
              alternatives: [],
            })),
          }
        : context.task === 'culture'
          ? {
              roots: ['Vel', 'Lor', 'Mar', 'Ser'],
              endings: ['a', 'en', 'is'],
              convention: 'Shared local roots.',
              demonym: '-an',
            }
          : {
              title: context.task === 'historian' ? 'What the records say' : 'A place in the local record',
              text: 'The surviving record describes this place and its surrounding province. Earlier history is not established by the available evidence.',
              sources: context.facts?.slice(0, 2).map((f: any) => f.id) ?? [],
            }
    return Response.json({
      model: request.model,
      choices: [{ message: { content: JSON.stringify(proposal) }, finish_reason: 'stop' }],
      usage: { completion_tokens: 50, cost: 0 },
    })
  },
  service,
)
export default defineConfig({
  root,
  esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: 5202, strictPort: true },
  preview: { host: '127.0.0.1', port: 5202, strictPort: true },
  build: {
    outDir: '/private/tmp/uchrony-atlas-browser',
    emptyOutDir: true,
    rollupOptions: { input: root + '/tests/browser/almanac.html' },
  },
  plugins: [
    {
      name: 'almanac-qualification',
      configureServer(server) {
        server.middlewares.use(middleware)
      },
      configurePreviewServer(server) {
        server.middlewares.use(middleware)
      },
    },
  ],
})
