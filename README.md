# EcoLiving Customer Connectors — commercetools Connect *(course Sessions 5.8 · 7 · 8)*

Three Connect applications on the one resource every shopper creates — the Customer — chosen because
they put the two extensibility mechanisms of Session 7 side by side on the same object, each where it
belongs. The order flow (cart rules, order events) lives in
[`ecoliving-order-connectors`](https://github.com/commercetools/ecoliving-order-connectors); the nightly
price feed in [`ecoliving-price-feed-connector`](https://github.com/commercetools/ecoliving-price-feed-connector).

| Folder | Type | Mechanism | What it does | Why that mechanism |
|---|---|---|---|---|
| [`customer-number-generator/`](customer-number-generator) | `service` | **API Extension** on `customer` · `Create` | Assigns `EL-000042` to a customer that arrives without a number | The number must **exist when the customer is saved**: the ERP, the invoice and the welcome mail all read it from version 1. Only an Extension runs *before* the save |
| [`email-verification-sender/`](email-verification-sender) | `event` | **Subscription** on `CustomerCreated` · `CustomerEmailChanged` | Issues a verification token and "mails" the link | A mail is a **side effect after the save**, and it needs the customer's id, which does not exist before it. An Extension on Create has no id and must answer in 2 s |
| [`email-verification-receiver/`](email-verification-receiver) | `service` | a plain **public endpoint** | The link target: confirms the token, redirects to the storefront | A verification link is a browser GET; *something with an API client* must receive it. With a BFF, that is the BFF (task 5.8). Without one, this |

**One branch, `main`.** Participants do not implement these; the trainer walks the code through and
installs the connector once into the shared project. **Cut a tag before creating the ConnectorStaged —
Connect deploys tags, not branches.**

## Why this is a separate repository

Connect deploys a **GitHub repository at a git tag**, and **`connect.yaml` must be at the repository
root**. It is authored in the course build repo at `courses/b2c-dev/code/customer-connector/` and synced
here by `sync-connector.sh`. It is separate from the order connector because its lifecycle is different:
these apps are a demo you install and never touch, the order apps are what participants' Session 7
handlers become — and a broken demo app must never block the Session 9 deployment.

---

## Which track uses which link

The sender puts one of two links into the mail, chosen by `VERIFY_LINK_MODE`:

| Mode | Link | Who confirms | Track |
|---|---|---|---|
| `storefront` (default) | `STOREFRONT_URL/verify-email?token=…` | the storefront page hands the token to its **BFF**, which calls `POST /customers/email/confirm` — course task **5.8** | the SDK Developer course (has a BFF) |
| `connector` | `RECEIVER_URL/email-verification-confirm?token=…` | the **receiver app** confirms and redirects to `STOREFRONT_URL/verify-email?status=ok` | the Commerce Integration Layer course (no BFF) |

In the BFF track the receiver app is deployed but idle; that is cheaper than two connectors. In
production you would pick one mode and delete the other path.

## The mail outbox — the stand-in for a mail provider

The training project has no SendGrid, SES or SMTP. Instead of pretending, the sender writes the mail it
*would* have sent into a Custom Object — container `ecoliving-mail-outbox`, key = customer id:

```json
{ "customerId": "…", "email": "ada@lhc.test", "kind": "email-verification",
  "tokenValue": "…", "link": "http://localhost:3000/verify-email?token=…",
  "expiresAt": "…", "createdAt": "…", "messageId": "…" }
```

The BFF's account page reads it back and shows the link (task 5.8, "would be e-mailed"). Everything
before that hop — the Subscription, the token, the link, the idempotency — is what production does. The
hop itself is `deliver()` in `outbox.service.ts`, the one function you replace with a provider.

**`messageId` is the idempotency key.** A redelivered `CustomerCreated` finds its own message id in the
outbox and stops; a `CustomerEmailChanged` has a new id and sends a fresh link, because the old address
is gone and the old link must die with it.

## Fail-open or fail-closed

| Dependency is down | Behaviour | Why |
|---|---|---|
| The **counter Custom Object** cannot be read or advanced | **Fail open** — the customer is approved without a number, logged as an error | A number can be backfilled tomorrow; a shopper who could not sign up is gone |
| Two sign-ups hit the counter at once | One **409**, one retry, then give up (fail open) | The Extension budget is 2 s; two attempts fit, a loop does not |
| The **generator app** is down | **Sign-ups fail** (`ExtensionBadResponse`) — the platform's choice, not ours | An Extension couples your availability to the operation. That is the cost of "before the save" |
| The **customer cannot be read** by the sender | **Acknowledge and drop** | Permanent: redelivery will not make a deleted customer reappear |
| The **email token** or the **outbox** answers 409 / 429 / 5xx | **Nack** — the platform redelivers | Transient, and the handler is idempotent |
| The **mail provider** throws | **Nack** | The token exists; the redelivery finds the outbox entry and stops — the honest limit of at-least-once with two effects |
| The **platform** is unavailable to the receiver | Redirect with `status=retry` | The link is fine; the shopper should click again, not request a new one |

## Scopes

Declared as `inheritAs.apiClient.scopes`, so **Connect generates an API Client holding exactly these**.

| Scope | Needed by | For |
|---|---|---|
| `manage_extensions` | customer-number-generator | registering and removing its own Extension |
| `manage_subscriptions` | email-verification-sender | registering and removing its own Subscription |
| `manage_customers` | sender · receiver | reading the customer, the email token, the email confirm |
| `manage_key_value_documents` | generator · sender | the counter · the outbox |

## Configuration

### `customer-number-generator`
| Key | Kind | Default | Purpose |
|---|---|---|---|
| `EXTENSION_SECRET` | **secured** | — | Shared secret the platform presents on every Extension call. Required: the endpoint is public |
| `CUSTOMER_NUMBER_PREFIX` | standard | `EL-` | `EL-` + six zero-padded digits |
| `LOG_LEVEL` | standard | `info` | |

### `email-verification-sender`
| Key | Kind | Default | Purpose |
|---|---|---|---|
| `STOREFRONT_URL` | standard | `http://localhost:3000` | The link's base in `storefront` mode |
| `VERIFY_LINK_MODE` | standard | `storefront` | `storefront` · `connector` (see above) |
| `RECEIVER_URL` | standard | — | The receiver app's public URL, required in `connector` mode. One app cannot read another's `CONNECT_SERVICE_URL`: copy it from the deployment page after the first deploy, then redeploy |
| `TOKEN_TTL_MINUTES` | standard | `4320` | Link validity (3 days; platform cap 43200) |
| `MAX_MESSAGE_AGE_HOURS` | standard | `72` | Backlog guard |
| `LOG_LEVEL` | standard | `info` | |

### `email-verification-receiver`
| Key | Kind | Default | Purpose |
|---|---|---|---|
| `STOREFRONT_URL` | standard | `http://localhost:3000` | Where the shopper lands: `/verify-email?status=ok\|invalid\|retry` |
| `LOG_LEVEL` | standard | `info` | |

---

## Run it locally

```bash
npm i -g @commercetools/cli                      # the Connect CLI
cp customer-number-generator/.env.example customer-number-generator/.env   # and the same for the other two
commercetools connect validate                   # connect.yaml, before Connect judges it
cd customer-number-generator && npm install && npm test && npm run build && npm start   # :8093 (sender :8092, receiver :8094)
```

Locally the `CTP_*` values come from `.env`; deployed, Connect injects them.

### Exercising the generator by hand

```bash
curl -s localhost:8093/customer-number -H 'content-type: application/json' \
  -H "Authorization: Bearer $EXTENSION_SECRET" \
  -d '{"action":"Create","resource":{"typeId":"customer","id":"c1","obj":{"email":"ada@lhc.test"}}}'
```
→ `200 { "actions": [{ "action": "setCustomerNumber", "customerNumber": "EL-000001" }] }`. Send it again:
`EL-000002`. Add `"customerNumber":"LEGACY-7"` to `obj` → `200` with an empty body: the rule fills a gap,
it never overwrites. Drop the `Authorization` header → `401`.

### Replaying a sign-up by hand

There is **no Subscription on a laptop**, so you deliver the same base64 envelope Connect will:

```bash
MSG='{"id":"m-1","type":"CustomerCreated","resource":{"typeId":"customer","id":"<a real customer id>"}}'
curl -s localhost:8092/email-verification -H 'content-type: application/json' \
  -d "{\"message\":{\"data\":\"$(printf '%s' "$MSG" | base64)\"}}"
```
Then read the outbox: `GET /{projectKey}/custom-objects/ecoliving-mail-outbox/<customer id>`. Send the
envelope **twice**: one link, not two.

### Confirming by hand

```bash
curl -s localhost:8094/email-verification-confirm -H 'content-type: application/json' -d '{"tokenValue":"<from the outbox>"}'
# or, as the browser would: curl -si 'localhost:8094/email-verification-confirm?token=<value>'   → 302 …/verify-email?status=ok
```

---

## Deploy it *(trainer)*

| # | Step | Note |
|---|---|---|
| 1 | Tag `main` (e.g. `v1.0.0`) | the tag is what Connect deploys |
| 2 | Create the **ConnectorStaged** — repo URL + tag, `privateProjects: ["<region>:<projectKey>"]` | needs `manage_connectors` |
| 3 | **Request preview**, wait for `isPreviewable: true` | runs the validation pipeline |
| 4 | **Publish for private use** (`certification: false`) | |
| 5 | **Deploy** (`sandbox`), supplying `EXTENSION_SECRET` | up to **15 minutes** |
| 6 | *CIL track only:* copy the receiver's URL into `RECEIVER_URL`, set `VERIFY_LINK_MODE=connector`, redeploy | one app cannot read another's URL |

### Values to enter at install *(Merchant Center → Connect → Manage connectors → Install)*

**Repository:** `https://github.com/commercetools/ecoliving-customer-connectors.git` · **Tag:** `v1.0.0` ·
**Deployment type:** `sandbox` · **Region:** the project's (the course project: `europe-west1.gcp`).

No `CTP_*` credentials are asked for: Connect generates the API client from `inheritAs.apiClient.scopes`.

| App | Key | BFF track (course default) | CIL track | Notes |
|---|---|---|---|---|
| `customer-number-generator` | `EXTENSION_SECRET` *(secured, required)* | a fresh random value: `openssl rand -hex 32` | same | write-only; keep it in your password manager, changing it means a redeploy |
| | `CUSTOMER_NUMBER_PREFIX` | `EL-` | `EL-` | numbers come out as `EL-000001` |
| | `LOG_LEVEL` | `info` | `info` | `debug` to see every Extension call |
| `email-verification-sender` | `STOREFRONT_URL` | `http://localhost:3000` | the CIL storefront's URL, e.g. `http://localhost:3000` | the mail's link targets `<STOREFRONT_URL>/verify-email?token=…`; localhost works because each participant opens it on their own laptop |
| | `VERIFY_LINK_MODE` | `storefront` | `connector` (second deploy, see step 6) | `storefront` = the BFF confirms (task 5.8); `connector` = the receiver app confirms |
| | `RECEIVER_URL` | *(leave empty)* | the receiver's URL from the first deployment, e.g. `https://service-xxxxxxxx.europe-west1.gcp.commercetools.app` | only read in `connector` mode; startup fails fast if `connector` mode has no value |
| | `TOKEN_TTL_MINUTES` | `4320` | `4320` | 3 days |
| | `MAX_MESSAGE_AGE_HOURS` | `72` | `72` | older messages are acknowledged and dropped |
| | `LOG_LEVEL` | `info` | `info` | the "sent" link is logged at `info`: the deployment log doubles as the inbox |
| `email-verification-receiver` | `STOREFRONT_URL` | `http://localhost:3000` | the CIL storefront's URL | where it redirects after confirming: `/verify-email?status=ok\|invalid\|retry` |
| | `LOG_LEVEL` | `info` | `info` | |

**After the deployment is `Deployed`:** the deployment page lists each app's URL (`*.commercetools.app`). Note the
receiver's URL for the CIL track, then check the two registrations below. The BFF needs nothing new: its course API
client already holds `manage_project`, which covers reading the `ecoliving-mail-outbox` Custom Object.

**Sandbox scales to zero and needs ~15 s to boot**, while an Extension's budget is **2 s** — so the first
sign-up after an idle period gets no number (fail open) or fails. Warm the generator before a demo.

### Verify from the API, not from the UI

```bash
GET /extensions?where=key%3D%22ecoliving-customer-number%22          # destination.url ends .commercetools.app
GET /subscriptions?where=key%3D%22ecoliving-email-verification%22    # destination.type = GoogleCloudPubSub
```

### Teardown

`preUndeploy` deletes both. **An orphaned Extension fails every sign-up on the project**, on a 2-second
timeout, for whoever inherits it. After undeploying, run the two queries above and confirm they are empty.

## Platform limits worth knowing

| Type | Limits that shaped this code |
|---|---|
| `service` | Extension budget **2 s** (10 s max) · sandbox cold start **~15 s** · max 25 Extensions per project |
| `event` | **10 s** to acknowledge · retry on anything outside `102·200·201·202·204` · unacked retained **7 days** · at-least-once, **no ordering**, **no condition** |
