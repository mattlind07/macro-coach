import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In production the /api routes are Vercel serverless functions.
// This plugin wires them up inside the Vite dev server so `npm run dev`
// works without needing `vercel dev`.
function apiPlugin() {
  return {
    name: 'vite-api',
    configureServer(server) {
      const handlers = {}

      server.middlewares.use('/api', async (req, res, next) => {
        const route = req.url.split('?')[0].replace(/^\//, '')
        if (!route) return next()

        if (!handlers[route]) {
          try {
            const mod = await import(`./api/${route}.js`)
            handlers[route] = mod.default
          } catch {
            return next()
          }
        }

        const handler = handlers[route]
        if (typeof handler !== 'function') return next()

        try {
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          const bodyStr = Buffer.concat(chunks).toString()
          req.body = {}
          try { if (bodyStr) req.body = JSON.parse(bodyStr) } catch {}

          // expose query params the same way Vercel does
          req.query = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams)

          let statusCode = 200
          const resHeaders = { 'Content-Type': 'application/json' }

          const mockRes = {
            status(code) { statusCode = code; return mockRes },
            json(data) {
              res.writeHead(statusCode, resHeaders)
              res.end(JSON.stringify(data))
            },
            setHeader(k, v) { resHeaders[k] = v },
          }

          await handler(req, mockRes)
        } catch (err) {
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: err.message }))
          }
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), apiPlugin()],
})
