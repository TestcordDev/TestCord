# LiveFix Integration

LiveFix is a real-time debugging bridge between opencode and the running Discord client. It lets agents search webpack modules, read source code, evaluate JavaScript, and test regex patterns against live module code — all without restarting Discord.

## Enabling

1. Open Discord Settings > Plugins > TestcordHelper
2. Enable the **LiveFix** toggle
3. An HTTP server starts on `http://127.0.0.1:18963`

The server stays running until the toggle is turned off or Discord is closed.

## Protocol

Send HTTP POST requests with a JSON body. Each request must have an `id` (any string for correlating responses) and an `action`. The response is JSON with the same `id`.

### Actions

#### `search` — Search webpack module factories for a string

```json
{"id": "1", "action": "search", "query": "viewFullBioDisabled"}
```

Returns up to 20 modules whose factory function source contains the query (case-insensitive):

```json
{"id": "1", "results": [{"id": 442228, "snippet": "442228(e,t,n){..."}]}
```

#### `readModule` — Read a module's export source

```json
{"id": "2", "action": "readModule", "moduleId": 681747}
```

Returns the stringified exports of the module:

```json
{"id": "2", "source": "...module source..."}
```

Note: For React components this may return `[object Object]`. Use `eval` with `wreq.m[id].toString()` to read the factory source instead.

#### `eval` — Execute JavaScript in the renderer context

```json
{"id": "3", "action": "eval", "code": "Vencord.Webpack.wreq.m[\"681747\"].toString().slice(0, 500)"}
```

Returns the result as a string:

```json
{"id": "3", "result": "681747(e,n,t){t.r(n),t.d(n,{default:()=>di})..."}
```

Available globals in eval:
- `Vencord` — the Vencord global object
- `Vencord.Webpack.wreq` — webpack require function (`wreq.m` = factories, `wreq.c` = cache)
- `Vencord.Webpack.cache` — webpack module cache
- `Vencord.Plugins` — plugin manager
- `FluxDispatcher` — Discord's flux dispatcher (via `Vencord.Webpack.Common.FluxDispatcher`)
- All Discord stores and components via `Vencord.Webpack.Common`

#### `testPattern` — Test a regex against source code

```json
{
  "id": "4",
  "action": "testPattern",
  "pattern": "children:\\((0,\\i\\.jsx)\\((\\i\\.A),\\{userId:(\\i)\\.id\\}\\)\\)",
  "code": "children:(0,l.jsx)(s5.A,{userId:n.id})",
  "flags": ""
}
```

Returns match details:

```json
{
  "id": "4",
  "matched": true,
  "match": "children:(0,l.jsx)(s5.A,{userId:n.id})",
  "groups": ["0,l.jsx", "s5.A", "n"],
  "index": 0,
  "input": "children:(0,l.jsx)(s5.A,{userId:n.id})"
}
```

#### `listPending` — List all pending (unapplied) webpack patches

```json
{"id": "5", "action": "listPending"}
```

Returns all patches that haven't matched any module yet:

```json
{"id": "5", "pending": [{"plugin": "BetterJoinedDate", "find": "...", "matches": ["..."]}]}
```

#### `patchHealth` — Get patch failure diagnostics

```json
{"id": "6", "action": "patchHealth"}
```

Returns all plugins with patch failures and runtime errors:

```json
{"id": "6", "health": [{"plugin": "Questify", "patchFailures": [...], "runtimeErrors": [...]}]}
```

## Usage Examples

### Find the new module ID for a feature

```bash
curl -s -X POST http://127.0.0.1:18963 \
  -H "Content-Type: application/json" \
  -d '{"id":"1","action":"search","query":"openPrivateChannel=()=>{let{user:e}=this.props"}'
```

### Read a module's factory source (first 500 chars)

```bash
curl -s -X POST http://127.0.0.1:18963 \
  -H "Content-Type: application/json" \
  -d '{"id":"2","action":"eval","code":"Vencord.Webpack.wreq.m[\"688376\"].toString().slice(0,500)"}'
```

### Search all factories for multiple terms at once

```bash
curl -s -X POST http://127.0.0.1:18963 \
  -H "Content-Type: application/json" \
  -d '{"id":"3","action":"eval","code":"const w=Vencord.Webpack.wreq; const r=[]; for(const id in w.m){const s=w.m[id].toString(); if(s.includes(\"originLabel\")) r.push(id)} r"}'
```

### Test a patch regex against live module source

```bash
curl -s -X POST http://127.0.0.1:18963 \
  -H "Content-Type: application/json" \
  -d '{"id":"4","action":"testPattern","pattern":"popAnimation=\\(\\)=>\\{let\\{opacity","code":"popAnimation=()=>{let{opacity:e,scale:t}=this.state","flags":""}'
```

### Get context around a match in a module

```bash
curl -s -X POST http://127.0.0.1:18963 \
  -H "Content-Type: application/json" \
  -d '{"id":"5","action":"eval","code":"const s=Vencord.Webpack.wreq.m[\"994064\"].toString(); const i=s.indexOf(\"popAnimation\"); s.slice(Math.max(0,i-100),i+200)"}'
```

## How It Works

1. The TestcordHelper setting `liveFix` starts an HTTP server in the Electron main process (via `native.ts`)
2. The renderer polls a file queue (`/tmp/opencode/livefix/`) every 100ms for commands
3. When opencode sends a POST, the main process writes the request to `command.json`
4. The renderer reads it, executes the action, and writes the response to `response.json`
5. The main process reads the response and sends it back as the HTTP response

The timeout is 10 seconds — long-running evals will time out.

## Architecture

```
opencode (curl) → HTTP :18963 → main process → command.json → renderer (100ms poll) → response.json → main process → HTTP response
```

Files:
- `src/testcordplugins/TestcordHelper/native.ts` — HTTP server + file queue in main process
- `src/testcordplugins/TestcordHelper/index.tsx` — request handler in renderer (search, eval, testPattern, etc.)
