# QuenchSip

QuenchSip is a water control room for plastic-free events. When an event replaces plastic bottles with refill stations, QuenchSip:
- plans how many 20 L jars and cups each station needs,
- checks every station is stocked before the gates open,
- predicts which station is about to run dry and sends a runner,
- gives the organiser the numbers at the end.

Built for Environmental Hacks (WeMakeDevs x AWS), Waste and Energy track, 8-11 Oct 2026.

## Status
- [x] Step 1: plan calculator (jars and cups per station per hour, low/high range, readiness check)
- [x] Step 2: save event (organiser PIN), manage stations and runners, printable station QR codes, volunteer station page
- [ ] Step 0: AWS deploy (SAM: API Gateway + Lambda + DynamoDB; S3 + CloudFront for the site)
- [ ] Next: volunteer taps, offline queue, live board

## Architecture
| Piece | Local | AWS |
|---|---|---|
| Website | `python3 -m http.server` on `web/` | S3 + CloudFront |
| API | `src/local/server.js` → Lambda handler | API Gateway (HTTP API) → Lambda (`src/api/handler.js`) |
| Data | DynamoDB Local (Docker) | DynamoDB (single table, `PK`/`SK`) |

## Run locally
Needs Node 20+, Python 3, Docker and Google Chrome (for the browser test).

```bash
npm install
npm run db:start     # DynamoDB Local in Docker (in memory, telemetry off)
npm run db:table     # create the table
npm run api          # API on http://localhost:3001 (separate terminal)
npm run serve        # site on http://localhost:8080 (separate terminal)
```

Open http://localhost:8080. On a phone, use your laptop's Wi-Fi IP (e.g. `http://192.168.1.5:8080`). The site finds the API on port 3001 of the same host.

## Tests
```bash
npm test             # unit: plan maths, validation, PIN hashing
npm run test:int     # integration: API handler against DynamoDB Local
npm run test:e2e     # browser: plan -> event -> PIN -> QR -> station (needs api + serve running)
```

## Layout
```
src/core/     pure logic shared by browser and Lambda (plan.js, event.js)
src/lib/      DynamoDB access, events, PIN hashing (Node only)
src/api/      Lambda handler (HTTP API, payload v2)
src/local/    local dev server around the handler
scripts/      create-table.js for DynamoDB Local
web/          static site (plan, event, qr, v = volunteer)
test/ itest/ e2e/   unit, integration, browser tests
template.yaml SAM template
```

## Data model (one partition per event)
| SK | Item |
|---|---|
| `META` | event settings, organiser PIN hash (scrypt + salt, never returned by the API) |
| `STN#<id>` | station: name, zone, stock |
| `RUN#<id>` | runner: name, status |

The plan is computed when the event is read, so it always matches the current stations.

## Assumptions in the plan
| Value | Default | Source |
|---|---|---|
| Water per person per hour | 0.25-0.5 L | High: government advisory for outdoor summer events (500 ml per person per hour). Low: our assumption |
| Weather factor | 1 / 1.3 / 1.6 | Our assumption |
| Cup size | 200 ml | Our assumption |
| Stations | 1 per 500 people | Northern Territory (Australia) public-event guidance |

## AI tools used
- Claude Code (Anthropic): planning, code and tests, reviewed by the team.
