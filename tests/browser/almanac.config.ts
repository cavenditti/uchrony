import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { storytellerMiddleware } from '../../server/storyteller'
import { ModelService } from '../../server/model-settings'
import { LlmPolicy } from '../../server/llm-policy'
const root = fileURLToPath(new URL('../..', import.meta.url))
const service = new ModelService()
await service.initialize({
  OPENROUTER_MODEL: 'test/strategist',
  OPENROUTER_WRITING_MODEL: 'test/writer',
  OPENROUTER_DECISION_MODEL: 'test/writer',
})
service.models = [
  {
    id: 'test/writer',
    name: 'Small writer · qualification stub',
    context: 32000,
    inputPrice: 0.15,
    outputPrice: 0.15,
    structured: true,
    json: true,
    outputLimit: 8000,
  },
  {
    id: 'test/strategist',
    name: 'Strategist · qualification stub',
    context: 64000,
    inputPrice: 0.3,
    outputPrice: 1,
    structured: true,
    json: true,
    outputLimit: 12000,
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
