#!/usr/bin/env node
/**
 * A draft/filehost server, for developing against.
 *
 * Written from the specification rather than from Switchboard, which is the
 * whole point of it: a test server built from the client it is meant to check
 * agrees with that client about everything, including whatever both get wrong.
 * No network reachable from here advertises the token yet, so without this the
 * upload path could only be read, not run.
 *
 * It answers the three things the spec requires and nothing else. `OPTIONS` on
 * the upload URI, with an `Accept-Post` naming what it takes. `POST`, answered
 * `201 Created` with a relative `Location`. `GET` and `HEAD` on the address it
 * gave back. Files are kept in memory and go when it stops.
 *
 *   node scripts/filehost.mjs 18080 "image/*, text/plain"
 *
 * Then point an ircd at `http://127.0.0.1:18080/upload` with a `draft/FILEHOST`
 * ISUPPORT token. It logs every request, which is usually the thing you wanted
 * to see.
 *
 * Deliberately has no authentication. It is for finding out whether an upload
 * works, not for keeping anything.
 */
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { extname } from 'node:path'

const port = Number(process.argv[2] ?? 18080)
const acceptPost = process.argv[3] ?? 'image/*, text/plain'
const stored = new Map()

const log = (...a) => console.log(new Date().toISOString(), ...a)

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`)

    if (req.method === 'OPTIONS' && url.pathname === '/upload') {
      log('OPTIONS', acceptPost)
      res.writeHead(204, { Allow: 'OPTIONS, POST', 'Accept-Post': acceptPost })
      res.end()
      return
    }

    if (req.method === 'POST' && url.pathname === '/upload') {
      const type = req.headers['content-type'] ?? ''
      const disposition = req.headers['content-disposition'] ?? ''
      const auth = req.headers['authorization'] ?? ''
      log(
        'POST',
        JSON.stringify({ type, disposition, auth: auth.slice(0, 12) + (auth ? '…' : '') })
      )

      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        const body = Buffer.concat(chunks)
        const ext = /filename="([^"]*)"/.exec(disposition)?.[1]
        const id = randomBytes(6).toString('hex') + (ext ? extname(ext) : '')
        stored.set(id, { body, type, disposition })
        log('stored', id, body.length, 'bytes')
        res.writeHead(201, { Location: `/upload/${id}` })
        res.end()
      })
      return
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/upload/')) {
      const item = stored.get(url.pathname.slice('/upload/'.length))
      if (!item) {
        res.writeHead(404)
        res.end()
        return
      }
      res.writeHead(200, {
        'Content-Type': item.type,
        'Content-Length': item.body.length,
        'Content-Disposition': item.disposition
      })
      res.end(req.method === 'HEAD' ? undefined : item.body)
      return
    }

    res.writeHead(404)
    res.end()
  })
  .listen(port, '127.0.0.1', () => log(`filehost on 127.0.0.1:${port}, Accept-Post: ${acceptPost}`))
