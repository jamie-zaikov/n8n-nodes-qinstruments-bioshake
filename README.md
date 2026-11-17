# n8n-nodes-qinstruments-bioshake

An n8n community node for the QInstruments BioShake shaker. The node calls the HTTPS REST API
[`qinstruments-bioshake-api`](https://github.com/jamie-zaikov/qinstruments-bioshake-api), which
drives the BioShake over RS-232 from the PC that it is attached to. The node and the API are one
pair: see [Paired API](#paired-api).

Sections of this README:

- [Purpose](#purpose), with the [vendored node base](#vendored-node-base)
- [Install into n8n](#install-into-n8n), with [Build and load](#build-and-load)
- [Credential setup](#credential-setup)
- [Operations](#operations)
- [Error behaviour](#error-behaviour)
- Recovery procedures: [Safety: stop operations and Continue On Fail](#safety-stop-operations-and-continue-on-fail),
  [State gates (vendor-manual decode table)](#state-gates-vendor-manual-decode-table) and
  [Recovery procedures](#recovery-procedures)
- [Timed-shake pattern](#timed-shake-pattern) and
  [Temperature-poll pattern](#temperature-poll-pattern), with the two example workflows
- [API documentation](#api-documentation)
- [Placeholders](#placeholders), [License](#license) and [Paired API](#paired-api)

## Purpose

The n8n community node for the `qinstruments-bioshake` instrument, built on `n8n-node-core`. The
npm package name is the unscoped name `n8n-nodes-qinstruments-bioshake`. In the source project
the package defaulted to `"private": true` (FR-5.4, FR-18.7) and was flipped to
`"private": false` for `npm publish` only when the node was deliberately shared on the public
community channel. This repository is that public form: its `package.json` has no `private`
field, and a release is published to the public npm registry with `npm publish`.

The node reaches its paired api only over **HTTPS**, never by code import. The base URL and the
bearer token come from the node's n8n credential at runtime; the token is referenced, never
committed (NFR-1).

In the source project this node was a member of a root npm workspace and resolved
`n8n-node-core` from that workspace. In this repository the core is vendored: its source files
are under `src/vendor/n8n-node-core/`, and the build, the type check and the tests resolve
`n8n-node-core` to `src/vendor/n8n-node-core/index.ts` (see
[Vendored node base](#vendored-node-base)).

- Node type: `n8n-nodes-qinstruments-bioshake.qInstrumentsBioShake` (display name
  "QInstruments BioShake").
- Credential type: `qInstrumentsBioShakeApi`.
- Every operation sends exactly one HTTPS request and returns as soon as the API responds. The
  node has no internal wait, timer or polling loop (FR-18.3). A timed shake and a wait for a
  temperature are the workflow's job: see [Timed-shake pattern](#timed-shake-pattern) and
  [Temperature-poll pattern](#temperature-poll-pattern).

### Vendored node base

The shared TypeScript base `n8n-node-core` (C12, FR-5.2) ships inside this repository under
`src/vendor/n8n-node-core/`. In the source project it was the one base that every instrument node
and every other n8n node imported, a member of the root npm workspace that was always
`"private": true` (NFR-3); it is not published to the npm registry. Here it is bundled into the
built node at build time and is not a package dependency.

#### Surface of the vendored base

| Module | Purpose |
|--------|---------|
| `client` | The HTTP contract to reach the paired instrument API: `InstrumentApiClientOptions`, `buildAuthHeader`, `buildApiRequest`, `DEFAULT_TIMEOUT_MS`. |
| `errors` | The shared error hierarchy: `NodeCoreError`, `InstrumentApiError`. |
| `health` | The `HEALTH_PATH` contract, mirroring `instrument_api_core.health` on the Python side (the service base that is vendored in the paired API). |

#### Dependency direction of the vendored base

This core imports **nothing** back — not `instrument-api-core` and no node. A node reaches its API
only over **HTTP**, never by code import (a module boundary rule of the source project). The
bearer token comes from an n8n credential at runtime; it is referenced, never hard-coded, logged,
or committed (NFR-1).

#### Dependency-free base modules

The base is dependency-free TypeScript, so it builds (`tsc`), lints (`eslint`), and tests
(`vitest`) with only the dev toolchain of this repository. The concrete node adds `n8n-workflow`
and performs the actual HTTP transport; this base ships the pure request-descriptor logic and the
shared types. The QInstruments BioShake node of this repository is its one consumer.

## Install into n8n

The node runs in a self-hosted n8n instance. It needs the paired API on a host that the n8n host
can reach over HTTPS (TCP 8744 by default).

- **From the n8n editor:** open **Settings → Community nodes → Install**, enter the npm package
  name `n8n-nodes-qinstruments-bioshake`, confirm, and wait until n8n reports the node as
  installed.
- **By hand:** in the n8n custom nodes folder (by default `~/.n8n/nodes`), run
  `npm install n8n-nodes-qinstruments-bioshake`, then restart n8n.
- **From a local build:** build this repository (below), pack it with `npm pack`, and install the
  resulting `.tgz` file in the n8n custom nodes folder with `npm install` and the path of that
  file, then restart n8n.

After the install, the node "QInstruments BioShake" is in the node panel of the n8n editor.
Create its credential next: see [Credential setup](#credential-setup).

### Build and load

```sh
npm ci               # in a fresh clone of this repository
npm run lint
npm run build        # tsc --noEmit, then esbuild -> dist/ (CommonJS)
npm test
```

The lock file `package-lock.json` resolves every package from the public npm registry.

n8n loads community nodes with `require()`. The esbuild bundle is **CommonJS**, inlines
`n8n-node-core` (which is ESM and is not published to the npm registry) and keeps `n8n-workflow`
external (design DD-8). The `n8n` block of `package.json` points n8n at
`dist/credentials/QInstrumentsBioShakeApi.credentials.js` and
`dist/nodes/QInstrumentsBioShake/QInstrumentsBioShake.node.js`.

In the source project, a private release channel published the package to a private npm
registry, and the n8n image of that installation installed it from there. This repository
publishes to the public npm registry; an n8n instance installs it as described above.

## Credential setup

Create one credential of the QInstruments BioShake credential type (`qInstrumentsBioShakeApi`)
per API host:

| Field | Value |
|---|---|
| `baseUrl` | `https://<host>:8744` — the API host and port, for example `https://192.0.2.10:8744`. It must start with `https://`; plain HTTP is refused. |
| `token` | The bearer token of the API service (an n8n password field). Get it from the API operator; it is the value the service reads from the environment variable `QINSTRUMENTS_BIOSHAKE_API_TOKEN`. Never paste it into a workflow, a parameter, an expression or a file. |
| `caCertificate` | Optional, multi-line. The PEM text of the platform private CA that issued the API server certificate (public data, not a key). The API uses a private CA, so this field is normally needed; leave it empty only when the server certificate chains to a CA that Node.js already trusts. |

The node always verifies the server certificate; there is no option that turns verification off
(FR-18.1). The token is sent as a bearer token in the `Authorization` request header, over HTTPS
only, and is never copied into a node error message (FR-18.5).

## Operations

One operation per API capability, 22 in total (FR-18.2). The value column is the `operation`
parameter value in workflow JSON. There is no operation or field that sends a raw device command
(FR-6.2).

| Operation | Value | API request |
|---|---|---|
| Get Status | `getStatus` | `GET /v1/status` |
| Connect | `connect` | `POST /v1/connect` |
| Get Device Info | `getDeviceInfo` | `GET /v1/device-info` |
| Get Limits | `getLimits` | `GET /v1/limits` |
| Get Shake State | `getShakeState` | `GET /v1/shake/state` |
| Get ELM State | `getElmState` | `GET /v1/elm/state` |
| Get Error List | `getErrorList` | `GET /v1/errors` |
| Set Shake Speed | `setShakeSpeed` | `PUT /v1/shake/speed` `{rpm}` |
| Set Shake Acceleration | `setShakeAcceleration` | `PUT /v1/shake/acceleration` `{acceleration_s}` |
| Start Shaking | `startShaking` | `POST /v1/shake/start` `{rpm, acceleration_s?}` |
| Stop Shaking | `stopShaking` | `POST /v1/shake/stop` `{deceleration_s?}` |
| Home | `home` | `POST /v1/shake/home` |
| Lock Plate | `lockPlate` | `POST /v1/elm/lock` |
| Unlock Plate | `unlockPlate` | `POST /v1/elm/unlock` |
| Set Target Temperature | `setTargetTemperature` | `PUT /v1/temperature/target` `{temperature_c}` |
| Start Temperature Control | `startTemperatureControl` | `POST /v1/temperature/start` |
| Stop Temperature Control | `stopTemperatureControl` | `POST /v1/temperature/stop` |
| Get Actual Temperature | `getActualTemperature` | `GET /v1/temperature/actual` |
| Check At Target | `checkAtTarget` | `GET /v1/temperature/at-target?target_c=[&tolerance_c=]` |
| Stop All | `stopAll` | `POST /v1/stop-all` |
| Release | `release` | `POST /v1/release` |
| Reacquire | `reacquire` | `POST /v1/reacquire` |

The routes are those of the paired API. The committed snapshot `contract/api-routes.json` holds
the route contract of the API (method, path and query names of each route); the node tests check
every operation against it.

### Parameters

| Parameter | Name | Used by | Default |
|---|---|---|---|
| Speed (rpm) | `rpm` | Set Shake Speed, Start Shaking (required) | `500` |
| Acceleration (s) | `acceleration_s` | Set Shake Acceleration (required); Start Shaking (option in `shakeStartOptions`) | `0` |
| Deceleration (s) | `deceleration_s` | Stop Shaking (option in `shakeStopOptions`) | not set |
| Temperature (°C) | `temperature_c` | Set Target Temperature (required) | `37` |
| Target (°C) | `target_c` | Check At Target (required) | `37` |
| Tolerance (°C) | `tolerance_c` | Check At Target (option in `atTargetOptions`, 0.1-5.0) | not set = the API uses 1.0 |
| Timeout (ms) | `timeoutMs` | every operation | `120000` (max 2147483647) |

The API owns every range and limit check. A value outside the effective limits is refused with
HTTP 422 and the effective limits; Get Limits and Get Status show them.

### Timeout (ms): the margin formula

"Timeout (ms)" is the deadline of one API request. It must exceed the API worst case of the
slowest operation. With the default configuration the slowest operation is Stop All after a
`shakeOff` reply `e` (four transactions of up to 12.6 s each, because the API confirms the stop
with a shake-state read and an error-list read, plus the lock wait and about 2 s per attempt for
write and drain, 12 attempts: about 89 s). Home is next (about 67 s). Each term of the formula is
in seconds; the timeout must be larger than the larger of the two operations:

```
Timeout (ms) > max(Home: 12.6 s + (home_read_timeout + 1.2 s) + lock_wait_s + 2 s × 4, Stop All: 4 × 12.6 s + lock_wait_s + 2 s × 12)
```

The default `120000` ms still fits, but it fits the **default** API configuration only
(`home_read_timeout_ms` 30000, `lock_wait_s` 15: Home about 67 s, Stop All about 89 s).
When commissioning raises `home_read_timeout_ms` or `lock_wait_s` in the API manifest,
raise "Timeout (ms)" on every node by the same amount or more. A timeout that is too short aborts
a request that the API still completes, and the node then cannot tell whether the command ran.

### Response fields used by workflows

- **Check At Target** returns `at_target` (boolean), `actual_c`, `target_c` and `tolerance_c`. It
  is **one instantaneous reading**; the API has no "stable for N seconds" criterion. Equality is
  "at target".
- **Connect** returns `state`, `stopped_on_reconnect` and a status summary. A reconnect after a
  loss sends Stop Shaking and Stop Temperature Control to the device first (FR-14.4).
- **Stop Shaking** returns `outcome`: `stopped` or `already_stopped`.
- **Stop All** returns the outcome of each stop command: `stopped`, `already_stopped`, `failed`
  (with the failure) or `not_delivered`. Read every outcome.
- **`already_stopped`** means that the device replied `e` to `shakeOff` and the API then read shake
  state `3` (stopped and locked at home) and an empty error list. It is a **successful stop**: the
  shaker was already stopped. The body carries `device_reply` (`e`) and `confirmation` (the shake
  state and the error list that the API read).
- A `device_error` or `stop_all_failed` error body may also carry `confirmation`. That body is
  **not** a stop. A `device_error` on Stop Shaking means the confirmation did not show a stopped
  shaker; a `stop_all_failed` means at least one stop command did not succeed. Treat the device as
  possibly still shaking or heating, and read the outcome of each Stop All row.
- **Get Status** returns `state`, `transport_fake`, the device identity, the effective limits, the
  `families` permissions (`shake`, `elm`, `temperature`) and the `startup_state`.

## Error behaviour

A non-2xx API response raises an n8n `NodeOperationError` built only from the API error body
(FR-18.5):

```
QInstruments BioShake API <status> <kind>: <message>[; device reply: <device_reply>][; transport failure <failure>]
```

A request that gets no API response raises:

```
QInstruments BioShake API request failed (<reason>): <message>
```

where `<reason>` is one of `invalid_credentials`, `invalid_timeout`, `request_failed`, `timeout`,
`response_too_large` or `invalid_json`. A bad parameter raises
`QInstruments BioShake parameter error: ...`.

**`device reply` is raw device text.** It is copied from the device reply as received (control
characters removed, truncated to 300 characters). If a workflow renders an error message or the
`device_reply` field as HTML (an email, a web page, a chat card), escape it first.

Typical kinds:

| HTTP | Kind | Meaning and workflow action |
|---|---|---|
| 409 | `stop_not_delivered` | The message starts **"Stop was NOT delivered"**. The device is released to another program and the API could not open the port for the stop: the stop did **not** reach the device, so it may still shake or heat (FR-18.6). Do not treat it as stopped. Free the port (end the other program's session) and send the stop again, or stop the device at the instrument. |
| 409 | `gate_refused` | A safety gate refused the command; the body carries `observed_state`. See [State gates (vendor-manual decode table)](#state-gates-vendor-manual-decode-table). |
| 409 | `device_released` | The device is released (Release). Only the stops are allowed until Reacquire. |
| 409 | `family_not_permitted` | The command family (`shake`, `elm`, `temperature`) is blocked; the message gives the reason. Reads and stops stay allowed. |
| 409 | `invalid_state` | Connect while released, or Reacquire while disconnected or lost. |
| 422 | `validation_error` | A value outside the effective limits or a bad tolerance. |
| 501 | `command_unsupported` | The firmware does not support the command (`device_reply` raw). |
| 502 | `device_error` | The device replied with an error (`device_reply` raw). |
| 502 | `stop_all_failed` | Stop All: a stop command failed. Read the outcomes; the device may still shake or heat. |
| 502 | `reconnect_stop_failed` | Connect after a loss: a stop failed, the device stays `lost`. |
| 503 | `device_busy` | Another request held the device longer than `lock_wait_s`. Retry, especially a stop. |
| 503 | `device_not_connected` | The device is `disconnected` or `lost`. Run Connect. |
| 504 | `transport_error` | No reply, a parse failure or an unexpected reply. For an action command the result is unknown: confirm with Get Status or a state read. |

## Safety: stop operations and Continue On Fail

Stop Shaking, Stop Temperature Control and Stop All are **safety operations**. Treat every result
that is not a clear success as "the device may still shake or heat". For a shake stop, the two
clear successes are the outcomes `stopped` and `already_stopped`.

- **Do not enable "Continue On Fail" (On Error: Continue) on a stop node unless the workflow
  checks `json.error` right after it.** With Continue On Fail, a failed stop, including a 409
  "NOT delivered", becomes a normal output item `{ "error": "<message>" }` and the next node runs
  as if the stop worked.
- **A network failure or a timeout on a stop means the delivery is unknown.** The errors
  `(request_failed)` and `(timeout)` mean the node got no answer. Retry the stop, then confirm
  with Get Status or Get Shake State.
- A 502 or 504 on a stop also leaves the device state unknown or not stopped. Retry a stop on
  `503 device_busy`.

## State gates (vendor-manual decode table)

The API decodes the shake and ELM state codes with the decode table of the vendor manual, and four
operations check the decoded state before they send a command:

- **Start Shaking** needs ELM code `1` (`locked`).
- **Home** needs shake code `3` or `9`.
- **Lock Plate** and **Unlock Plate** need shake code `3` (`stopped_locked_home`). After a stop that
  left shake code `9`, the workflow calls Home first.

Any other code, and a code outside the manual table, returns 409 `gate_refused` with
`observed_state`. Stop Shaking, Stop All, Set Shake Speed, Set Shake Acceleration, all temperature
operations and all reads do not depend on the table.

## Recovery procedures

The recovery steps of this README, in one list (the sections above give the details):

- **409 `stop_not_delivered`:** the stop did not reach the device. Free the port (end the other
  program's session) and send the stop again, or stop the device at the instrument.
- **A network failure, a timeout, a 502 or a 504 on a stop:** retry the stop, then confirm with
  Get Status or Get Shake State. Retry a stop on `503 device_busy`.
- **409 `device_released`:** only the stops are allowed; run Reacquire when the other program has
  ended its session.
- **503 `device_not_connected`** (the device is `disconnected` or `lost`): run Connect. A
  reconnect after a loss sends Stop Shaking and Stop Temperature Control first; a 502
  `reconnect_stop_failed` leaves the device `lost`.
- **409 `gate_refused` on Lock Plate or Unlock Plate after a stop that left shake code `9`:** run
  Home first.
- **n8n failed between Start Shaking and Stop Shaking:** the device keeps shaking. Send Stop
  Shaking or Stop All by hand (or from a recovery workflow), and check with Get Shake State.

## Timed-shake pattern

The node returns immediately, so the shake duration is an n8n **Wait** node between Start
Shaking and Stop Shaking (FR-18.4, OQ-4):

```
Lock Plate
  -> Start Shaking (rpm)
  -> Wait (the shake duration)
  -> Stop Shaking
error output of Start Shaking, Wait or Stop Shaking -> Stop All -> Stop and Error
error output of Lock Plate                          -> Stop and Error (nothing was started)
```

**Risk (OQ-4): if n8n fails between Start Shaking and Stop Shaking** (a crash, a restart, a
deployment, a lost execution), **the device keeps shaking until a stop arrives.** The node and the
API do not stop the shaker by themselves. Send Stop Shaking or Stop All by hand (or from a
recovery workflow), and check with Get Shake State.

### Example: `examples/timed-shake.workflow.json`

[`examples/timed-shake.workflow.json`](examples/timed-shake.workflow.json): Manual Trigger ->
Lock Plate -> Start Shaking (1200 rpm) -> Wait (shake duration, 10 minutes) -> Stop Shaking ->
Shake Done. Start Shaking, the Wait and Stop Shaking use "On Error: Continue (using error
output)"; their error outputs call Stop All, then Stop and Error fails the execution. The error
output of Lock Plate goes straight to Stop and Error. Stop All has no Continue On Fail, so a
failed Stop All fails the execution visibly.

## Temperature-poll pattern

A workflow waits for a temperature with an n8n loop (FR-18.4):

```
Set Target Temperature
  -> Start Temperature Control
  -> loop:
       Check At Target
         -> IF json.at_target is true -> continue the process
         -> else: IF the iteration cap is not reached -> Wait (for example 30 s) -> back to Check At Target
                  else (cap reached)                  -> Stop Temperature Control -> Stop and Error
```

Rules for the loop:

- **Always cap the iterations.** In n8n, `{{ $runIndex }}` inside a node in the loop counts how
  often that node ran in this execution; compare it with a fixed cap.
- **Stability.** Check At Target is one reading. If the process needs a stable temperature,
  require N consecutive `at_target: true` results before you continue.
- **Wait interval.** 30 s is a sensible default. Do not poll faster than a few seconds: every poll
  takes the device lock and a serial transaction.
- **On the cap branch, stop temperature control** and fail the execution so the operator sees it.

### Example: `examples/heat-and-wait.workflow.json`

[`examples/heat-and-wait.workflow.json`](examples/heat-and-wait.workflow.json): Manual Trigger ->
Set Target Temperature (37 °C) -> Start Temperature Control -> Check At Target (target 37 °C) ->
At Target? (true -> Target Reached; false -> Below Iteration Cap? (true -> Wait 30 s -> Check At
Target; false -> Stop Temperature Control -> Stop and Error)). The cap is 60 checks (`$runIndex`
< 59), about 30 minutes.

### Using the examples

1. In n8n, import the file (Workflows -> Import from File).
2. Create a `qInstrumentsBioShakeApi` credential as described in
   [Credential setup](#credential-setup). The files reference a credential by name
   (`qinstruments-bioshake-lab`) with a placeholder id; select your own credential on each
   QInstruments BioShake node.
3. Change the speed, duration, target, wait interval and cap to suit the process. Replace the
   "Shake Done" / "Target Reached" node with the next step of the process.

The files hold no credential value, no token, no host and no certificate.

## API documentation

The API serves a documentation page (Swagger UI) at:

<https://192.0.2.10:8744/docs>

Open it in a browser that trusts the platform private CA certificate in the current-user store.
Press **"Authorize"** once and enter the bearer token; the page keeps it in page memory only. See
`api/README.md` section 5c of the source project, which is section
[5c. API documentation page](https://github.com/jamie-zaikov/qinstruments-bioshake-api#5c-api-documentation-page)
of the README of the paired API repository, for which networks can reach TCP 8744 and how to
trust the CA certificate for the current user.

The page itself needs no token, but `/openapi.json` and every `/v1` call still need the token.

Scripted path: fetch the API description with an authenticated request. The token is read from
the environment variable `QINSTRUMENTS_BIOSHAKE_API_TOKEN`; never paste the value into a command
or a file.

```sh
curl --cacert <path-to-platform-ca.crt> -H "Authorization: Bearer $QINSTRUMENTS_BIOSHAKE_API_TOKEN" https://192.0.2.10:8744/openapi.json  # pragma: allowlist secret
```

Windows (PowerShell):

```powershell
curl.exe --cacert <path-to-platform-ca.crt> --ssl-no-revoke -H "Authorization: Bearer $env:QINSTRUMENTS_BIOSHAKE_API_TOKEN" https://192.0.2.10:8744/openapi.json  # pragma: allowlist secret
```

The trailing `# pragma: allowlist secret` is a shell comment for the repository secret scanner
(the token is an environment-variable reference, not a value); it does not change the command.

`--ssl-no-revoke` only skips the CRL lookup on Windows; the certificate chain is still verified.
Never turn certificate verification off.

## Placeholders

The examples in this README and the files of this repository use the placeholder values below.
Replace each one with the value of your installation. The names in angle brackets inside the
base URL, the commands and the error formats (for example the host in the base URL, the CA file
path of the curl command, or the status and the message of an error) stand for the values of a
real installation or request.

<!-- placeholders:begin -->
| Placeholder | Meaning | Example |
|---|---|---|
| `192.0.2.10` | LAN address of the instrument API host. | 203.0.113.25 |
| `203.0.113.5` | Test address of a remote device in the transport tests. | 203.0.113.50 |
| `api-host.example.com` | DNS name of the instrument API host. | instrument-pc.lab.example |
| `user-pw-xyz@bioshake.example` | Neutral test-fixture user identity in the BioShake node tests (not a real account). | test-user@lab.example |
| `<private-doc-ref>` | Reference to a private document of your organization. | your site runbook |
| `<vendored-node-core>` | The vendored n8n-node-core TypeScript sources and their tests inside the node repository. | src/vendor/n8n-node-core |
| `the API host` | The Windows PC that runs the instrument API (prose form). | the instrument PC next to the device |
| `<api-host-role>` | Role name of the host that runs the instrument API. | instrument PC |
| `<reason>` | Failure reason in the error of a node request that got no API response. | timeout |
<!-- placeholders:end -->

## License

MIT; see [LICENSE](LICENSE). The vendored node base under `src/vendor/n8n-node-core/` is part of
this repository and has the same license.

## Paired API

This node and the REST service
[`qinstruments-bioshake-api`](https://github.com/jamie-zaikov/qinstruments-bioshake-api) are one
`qinstruments-bioshake` pair: the API is a host-resident FastAPI service that drives the
QInstruments BioShake on the `<api-host-role>` host over RS-232 (a Moxa NPort serial bridge,
mapped to a Windows Real COM port), and this node calls it from n8n workflows. They change, version, and ship
together. In the source project they lived side by side as `api/` and `node/` next to the
manifest `instrument.yaml`.

- [`qinstruments-bioshake-api`](https://github.com/jamie-zaikov/qinstruments-bioshake-api) — the
  REST service `qinstruments-bioshake-api`, built on `instrument-api-core` (vendored in that
  repository). It runs on the instrument host as a Windows service (api-hosting sub-pattern 3,
  host-resident); it is not a cloud deployable and needs no Terraform.
- This repository — the n8n community node `n8n-nodes-qinstruments-bioshake`, built on
  `n8n-node-core` (vendored). It reaches the api only over HTTPS, never by code import.
- `instrument.yaml` — the executable manifest (serial settings, device identity, limits, HTTP
  listener, capabilities, refs). It ships in the paired API repository, which reads it.
