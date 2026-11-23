// Stand-in for the agent harness (Hermes) behind the Agent Service: answers every call and logs it, so the check can
// see whether a hostile page ever got a run or a chat read through to the agent.
import http from 'node:http'
http.createServer((q, r) => {
  process.stdout.write(JSON.stringify({ m: q.method, u: q.url }) + '\n')
  r.setHeader('content-type', 'application/json')
  r.end(q.url.includes('models') ? '{"data":[{"id":"hermes"}]}' : '{}')
}).listen(8642, '0.0.0.0')
