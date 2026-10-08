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
- [x] Step 3: volunteer taps ("Jar swapped", "Last jar", "Cups low"), each counted exactly once
- [x] Step 4: offline queue (taps saved on the phone first, sent when there is signal; page opens offline)
- [ ] Step 0: AWS deploy (SAM: API Gateway + Lambda + DynamoDB; S3 + CloudFront for the site)
- [ ] Next: live board

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
| `TAP#<uuid>` | volunteer tap: type, station, when it happened (phone clock, checked), when received |

The plan is computed when the event is read, so it always matches the current stations.

**Taps count exactly once.** Each tap gets a random id on the phone. Storing the tap and updating the station's counters happen in one DynamoDB transaction, and the tap is stored only if its id is new. A retried tap is answered `200 duplicate` and changes nothing. Pressing the same button twice within 3 seconds counts as one tap.

**Taps survive no signal.** A tap is saved in the phone's IndexedDB before it is sent. Waiting taps are sent oldest first, retried with backoff (1 s, 2 s, 4 s … 30 s), and again when the phone comes back online or the page is reopened. The volunteer sees "3 taps saved on this phone, waiting to send" or "All taps sent". A service worker lets the station page open with no signal, but browsers allow it only on https or localhost, so on the deployed (https) site and not over plain-http Wi-Fi testing.

## API
| Method | Path | Who |
|---|---|---|
| GET | `/health` | anyone |
| POST | `/events` | organiser (sets PIN) |
| GET | `/events/{id}` | anyone with the link |
| POST, DELETE | `/events/{id}/stations[/{sid}]`, `/events/{id}/runners[/{rid}]` | organiser (`x-organiser-pin` header) |
| POST | `/events/{id}/stations/{sid}/taps` | volunteer (station QR link) |

## Assumptions in the plan
| Value | Default | Source |
|---|---|---|
| Water per person per hour | 0.25-0.5 L | High: government advisory for outdoor summer events (500 ml per person per hour). Low: our assumption |
| Weather factor | 1 / 1.3 / 1.6 | Our assumption |
| Cup size | 200 ml | Our assumption |
| Stations | 1 per 500 people | Northern Territory (Australia) public-event guidance |

## AI tools used
- Claude Code (Anthropic): planning, code and tests, reviewed by the team.
