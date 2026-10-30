import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { readCompatiblePreference, removeCompatiblePreference } from '../../shared/brandCompatibility.mjs'

function setup() {
  const modules = new Map()
  let networkCalls = 0
  let storageCalls = 0
  const context = vm.createContext({
    URL,
    fetch: () => {
      networkCalls++
      throw new Error('Preset selection must never make a request')
    },
    localStorage: {
      getItem: () => {
        storageCalls++
        throw new Error('Preset helpers must not read private storage')
      },
    },
  })
  function load(url) {
    if (modules.has(url.href)) return modules.get(url.href).exports
    const module = { exports: {} }
    modules.set(url.href, module)
    const compiled = ts.transpileModule(readFileSync(url, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    vm.runInContext(`(function(module,exports,require){${compiled}\n})`, context)(
      module,
      module.exports,
      (name) => {
        if (name.endsWith('/brandCompatibility.mjs'))
          return { readCompatiblePreference, removeCompatiblePreference }
        assert.ok(name.startsWith('.'), `Unexpected dependency ${name}`)
        return load(new URL(name.endsWith('.ts') ? name : `${name}.ts`, url))
      },
    )
    return module.exports
  }
  return {
    ...load(new URL('../src/local/ai/settings.ts', import.meta.url)),
    ...load(new URL('../src/local/ai/providers.ts', import.meta.url)),
    calls: () => ({ networkCalls, storageCalls }),
  }
}

const plain = (value) => JSON.parse(JSON.stringify(value))
const connection = (patch = {}) => ({
  endpoint: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  apiKey: 'synthetic-private-key-for-tests',
  enabled: false,
  allowContext: false,
  visionEnabled: false,
  ...patch,
})

test('official presets produce complete Chat Completions destinations without losing provider paths', () => {
  const x = setup()
  const expected = {
    deepseek: 'https://api.deepseek.com/chat/completions',
    qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    kimi: 'https://api.moonshot.cn/v1/chat/completions',
    zhipu: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    siliconflow: 'https://api.siliconflow.cn/v1/chat/completions',
    openai: 'https://api.openai.com/v1/chat/completions',
  }
  assert.deepEqual(plain(x.AI_PROVIDER_PRESETS.map((item) => item.id).sort()), Object.keys(expected).sort())
  for (const provider of x.AI_PROVIDER_PRESETS) {
    assert.equal(x.completionUrl(provider.endpoint), expected[provider.id])
    assert.ok(provider.models.length > 0)
    assert.equal(new Set(provider.models.map((item) => item.id)).size, provider.models.length)
    assert.ok(provider.models.every((item) => item.id && item.id !== x.CUSTOM_AI_MODEL))
    assert.equal(new URL(provider.keyUrl).protocol, 'https:')
    assert.equal(new URL(provider.docsUrl).protocol, 'https:')
  }
})

test('provider detection accepts equivalent base and complete URLs, including trailing slashes', () => {
  const x = setup()
  for (const provider of x.AI_PROVIDER_PRESETS) {
    const full = x.completionUrl(provider.endpoint)
    for (const endpoint of [provider.endpoint, `${provider.endpoint}/`, full, `${full}/`, ` ${full} `]) {
      assert.equal(x.findAiProvider(endpoint)?.id, provider.id)
      assert.equal(x.sameAiEndpoint(endpoint, provider.endpoint), true)
    }
  }
})

test('lookalike domains, extra paths and invalid destinations never match official presets', () => {
  const x = setup()
  const destinations = [
    'https://api.deepseek.com.attacker.example',
    'https://attacker-api.deepseek.com',
    'https://api.deepseek.com/another-proxy',
    'https://api.deepseek.com:8443',
    'https://api.deepseek.com@attacker.example',
    'https://api.deepseek.com?token=secret',
    'https://api.deepseek.com/#other',
    'http://api.deepseek.com',
    'not-a-url',
    '',
  ]
  for (const endpoint of destinations) {
    assert.equal(x.findAiProvider(endpoint), undefined, endpoint)
    assert.equal(x.sameAiEndpoint(endpoint, 'https://api.deepseek.com'), false, endpoint)
  }
})

test('new empty configuration gets a usable default without changing enablement or permissions', () => {
  const x = setup()
  const saved = { ...x.DEFAULT_AI_SETTINGS }
  const before = plain(saved)
  const result = x.initialAiSelection(saved)
  const provider = x.findAiProvider(result.endpoint)
  assert.equal(provider?.id, result.providerId)
  assert.ok(provider.models.some((item) => item.id === result.model))
  assert.equal(result.modelChoice, result.model)
  assert.deepEqual(plain(saved), before)
  assert.equal(saved.enabled, false)
  assert.equal(saved.allowContext, false)
  assert.equal(saved.visionEnabled, false)
})

test('existing custom configuration and unknown older model names are retained exactly', () => {
  const x = setup()
  const custom = connection({ endpoint: 'https://private-ai.example.test/chat/completions/', model: 'my-team-model' })
  assert.deepEqual(plain(x.initialAiSelection(custom)), {
    providerId: x.CUSTOM_AI_PROVIDER,
    endpoint: custom.endpoint,
    model: custom.model,
    modelChoice: x.CUSTOM_AI_MODEL,
  })
  const legacy = connection({ endpoint: 'https://api.deepseek.com/chat/completions/', model: 'deepseek-chat' })
  const result = x.initialAiSelection(legacy)
  assert.equal(result.providerId, 'deepseek')
  assert.equal(result.endpoint, legacy.endpoint)
  assert.equal(result.model, 'deepseek-chat')
  assert.equal(result.modelChoice, x.CUSTOM_AI_MODEL)
})

test('partially saved connections keep empty fields instead of silently adopting another service or model', () => {
  const x = setup()
  for (const saved of [
    connection({ endpoint: '', model: 'my-existing-model' }),
    connection({ endpoint: 'https://api.deepseek.com', model: '', apiKey: '' }),
    connection({ endpoint: '', model: '', apiKey: 'existing-synthetic-key' }),
  ]) {
    const result = x.initialAiSelection(saved)
    assert.equal(result.endpoint, saved.endpoint)
    assert.equal(result.model, saved.model)
    assert.equal(result.modelChoice, x.CUSTOM_AI_MODEL)
  }
})

test('blank key input reuses the saved key only for the exact normalized destination', () => {
  const x = setup()
  const saved = connection()
  assert.equal(x.aiDraftKey('https://api.deepseek.com/chat/completions/', '', saved), saved.apiKey)
  assert.equal(x.aiDraftKey(saved.endpoint, '  ', { ...saved, model: 'another-model' }), saved.apiKey)
  for (const endpoint of [
    'https://api.openai.com/v1',
    'https://api.deepseek.com/v1',
    'https://api.deepseek.com:8443',
    'https://api.deepseek.com.attacker.example',
    'https://api.deepseek.com?key=invalid',
    'invalid',
    '',
  ]) assert.equal(x.aiDraftKey(endpoint, '', saved), '', endpoint)
  assert.equal(x.aiDraftKey('https://api.openai.com/v1', ' new-synthetic-key ', saved), 'new-synthetic-key')
  assert.equal(saved.apiKey, 'synthetic-private-key-for-tests')
})

test('loading presets and changing selection metadata never reads storage or calls a service', () => {
  const x = setup()
  for (const provider of x.AI_PROVIDER_PRESETS) {
    for (const model of provider.models) {
      const saved = connection({ endpoint: provider.endpoint, model: model.id })
      x.initialAiSelection(saved)
      x.findAiProvider(provider.endpoint)
      x.aiDraftKey(provider.endpoint, '', saved)
    }
  }
  assert.deepEqual(x.calls(), { networkCalls: 0, storageCalls: 0 })
})
