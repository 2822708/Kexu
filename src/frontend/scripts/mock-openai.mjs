import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { replyFixture } from './ai-eval-fixtures.mjs'

/** Local-only compatible endpoint. It never logs or reflects Authorization headers. */
export async function createMockOpenAiServer({
  output = JSON.stringify(replyFixture),
  behavior = 'normal',
} = {}) {
  const requests = []
  const sockets = new Set()
  const timers = new Set()
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404)
      res.end()
      return
    }
    const chunks = []
    let bytes = 0
    for await (const chunk of req) {
      bytes += chunk.length
      if (bytes > 2 * 1024 * 1024) {
        res.writeHead(413)
        res.end()
        return
      }
      chunks.push(chunk)
    }
    let body
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      res.writeHead(400)
      res.end()
      return
    }
    // Only synthetic request bodies from this contract suite are retained in memory; keys are never retained.
    requests.push({
      model: body.model,
      messages: body.messages,
      stream: body.stream,
      authorizationPresent: Boolean(req.headers.authorization),
      cookiePresent: Boolean(req.headers.cookie),
    })
    const mode = typeof behavior === 'function' ? behavior(body) : behavior
    if (typeof mode === 'number') {
      res.writeHead(mode, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({ error: { message: 'synthetic upstream error; must not be echoed' } }),
      )
      return
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    const reply = typeof output === 'function' ? output(body) : output
    const emit = (payload) => res.write(`data: ${JSON.stringify(payload)}\r\n\r\n`)
    if (mode === 'error') {
      emit({ error: { message: 'synthetic secret in provider body; must not be echoed' } })
      res.end()
      return
    }
    if (mode === 'malformed') {
      res.end('data: {broken\n\n')
      return
    }
    const finish = () => {
      if (res.destroyed) return
      if (mode === 'oversize')
        emit({
          choices: [{ index: 0, delta: { content: 'x'.repeat(200000) }, finish_reason: null }],
        })
      else
        for (let i = 0; i < reply.length; i += 9)
          emit({
            choices: [{ index: 0, delta: { content: reply.slice(i, i + 9) }, finish_reason: null }],
          })
      if (mode !== 'truncate') {
        emit({
          choices: [{ index: 0, delta: {}, finish_reason: mode === 'length' ? 'length' : 'stop' }],
        })
        res.write('data: [DONE]\r\n\r\n')
      }
      res.end()
    }
    if (mode === 'slow' || mode === 'idle') {
      res.flushHeaders()
      emit({ choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })
      const timer = setTimeout(
        () => {
          timers.delete(timer)
          finish()
        },
        mode === 'idle' ? 10000 : 150,
      )
      timers.add(timer)
      res.once('close', () => {
        clearTimeout(timer)
        timers.delete(timer)
      })
    } else finish()
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  return {
    endpoint: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: async () => {
      for (const timer of timers) clearTimeout(timer)
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mock = await createMockOpenAiServer()
  process.stdout.write(
    `Mock only: ${mock.endpoint}\nUse any synthetic key and model mock. Responses are fixtures, not model evaluation.\n`,
  )
  const close = async () => {
    await mock.close()
    process.exit(0)
  }
  process.on('SIGINT', close)
  process.on('SIGTERM', close)
}
