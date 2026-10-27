# Install `ecoliving-customer-connectors` — participant guide *(breakout room)*

Three applications that show the two shapes of extensibility side by side:

| App | Type | Triggered by | Does |
|---|---|---|---|
| `customer-number-generator` | service | an **API Extension** on customer Create (before the save) | sets `customerNumber` = `EL-000123` |
| `email-verification-sender` | event | a **Subscription** on CustomerCreated / CustomerEmailChanged (after the save) | creates the email token, "sends" the link (demo outbox) |
| `email-verification-receiver` | service | the link in the mail (a browser GET) | confirms the token, redirects to the storefront |

**What you need:** Merchant Center access to the course organization with permission to manage connectors, and the
course project key. Nothing to build locally: Connect builds the tag itself.

**The repository must be readable by Connect.** It is private outside the training; the trainer makes it public for the
day (or grants the `connect-mu` machine user read access). A "repository not found" in step 2 means it is still private.

## 1 · Create the connector *(everyone, in your own name)*

A connector starts as a **ConnectorStaged**: a pointer to a GitHub repository **at a tag**. Creating one never touches
the project, so every participant can do this step.

Merchant Center → **Connect** → **Manage connectors** → **Create connector**, then:

| Field | Value |
|---|---|
| Name | `EcoLiving Customer Connectors — <your name>` |
| Key | `<yourname>-ecoliving-customer-connectors` *(keys are unique in the organization: use your own name)* |
| Repository URL | `https://github.com/commercetools/ecoliving-customer-connectors.git` |
| Tag | `v1.0.2` |
| Private projects | the course project, e.g. `europe-west1.gcp:<project-key>` |
| Supported regions | `europe-west1.gcp` |

<details><summary>The same step through the Connect API</summary>

```http
POST https://connect.europe-west1.gcp.commercetools.com/connectors/drafts
Authorization: Bearer <token with manage_connectors>
Content-Type: application/json

{
  "key": "<yourname>-ecoliving-customer-connectors",
  "name": "EcoLiving Customer Connectors — <your name>",
  "description": "Email verification sent by a Subscription consumer, a customer number set by an API Extension, and the link receiver.",
  "creator": { "title": "Participant", "name": "<your name>", "email": "<your email>", "company": "<company>", "noOfDevelopers": 1 },
  "repository": { "url": "https://github.com/commercetools/ecoliving-customer-connectors.git", "tag": "v1.0.2" },
  "privateProjects": ["europe-west1.gcp:<project-key>"],
  "supportedRegions": ["europe-west1.gcp"]
}
```
</details>

## 2 · Request the preview and wait for the validation

Open your connector → **Request preview** (API: `updatePreviewable`). Connect clones the tag and runs its pipeline:
build, tests, dependency and code scan for every application. This takes **a few minutes**. Refresh until the
status is **previewable**. If it fails, the report names the application and the step; the connector in this repository
passes it, so a failure here is almost always a wrong URL or tag, or a repository Connect cannot read.

## 3 · Publish it for private use

**Publish** → certification **off** (API: `{ "action": "publish", "certification": false }`). Publishing makes it a
**Connector** your project can install. Certification is only for the public marketplace.

## 4 · Deploy it *(one person per room — read this first)*

> **One deployment of this connector per project.** Its `postDeploy` registers the Extension `ecoliving-customer-number` and the Subscription `ecoliving-email-verification` under a **fixed key**, so a
> second deployment on the same project overwrites the first one's registration, and undeploying either removes it for
> both. In the breakout room, **everyone does steps 1–3; one person (the driver) deploys**, with the others watching the
> screen. If each of you has your own project, everyone can deploy.

Merchant Center → **Connect** → **Manage connectors** → **Organization connectors** → your connector → **Install** →
choose the project, region `europe-west1.gcp`, deployment type **Sandbox**, then enter the values below.

You are **not** asked for API credentials: `connect.yaml` declares `inheritAs.apiClient.scopes`, and Connect generates an
API client with exactly those scopes (`manage_extensions`, `manage_subscriptions`, `manage_customers`, `manage_key_value_documents`). That is least privilege you can read in the repository.

### Values

| App | Key | Sample value | Note |
|---|---|---|---|
| customer-number-generator | `EXTENSION_SECRET` **(secured, required)** | output of `openssl rand -hex 32` | write-only: keep a copy; the platform presents it on every Extension call |
| | `CUSTOMER_NUMBER_PREFIX` | `EL-` | |
| | `LOG_LEVEL` | `info` | `debug` logs every call |
| email-verification-sender | `STOREFRONT_URL` | `http://localhost:3000` | the mail's link is `<STOREFRONT_URL>/verify-email?token=…` |
| | `VERIFY_LINK_MODE` | `storefront` | `connector` for the CIL track (see the README) |
| | `RECEIVER_URL` | *(empty)* | only for `connector` mode |
| | `TOKEN_TTL_MINUTES` | `4320` | 3 days |
| | `MAX_MESSAGE_AGE_HOURS` | `72` | |
| | `LOG_LEVEL` | `info` | the "sent" link is logged here: the log is the inbox |
| email-verification-receiver | `STOREFRONT_URL` | `http://localhost:3000` | where it redirects after confirming |
| | `LOG_LEVEL` | `info` | |

**Before deploying:** messages must be enabled on the project (Settings → Project settings → Messages), or the
Subscription never receives CustomerCreated.

## 5 · Verify it works

The deployment takes **up to 15 minutes**. When it is **Deployed**, the log lists each app's URL
(`…commercetools.app/<endpoint>`), and both **postDeploy** steps are green ("Extension created", "Subscription created").

1. Open the generator's `…/customer-number` URL with `/status` instead of the endpoint once: the sandbox sleeps when idle
   and needs ~15 s to wake, while an Extension gets 2 s.
2. Create a customer in Merchant Center → **Customer number `EL-000001`**.
3. The sender's log shows the link; `GET /custom-objects/ecoliving-mail-outbox/<customerId>` holds the token.
4. `curl -si "<receiver URL>?token=<tokenValue>"` → `302` to `/verify-email?status=ok`; the customer is now verified.
   The seeder folder **Verify — customer connector** runs 2–4 for you.
5. Platform-side proof: `GET /extensions?where=key%3D%22ecoliving-customer-number%22` → `destination.url` ends in
   `.commercetools.app`; `GET /subscriptions?where=key%3D%22ecoliving-email-verification%22` → a `GoogleCloudPubSub` destination.

## 6 · Tear down

Undeploy → `preUndeploy` removes the Extension and the Subscription. Run the two queries in step 5 again: both must be empty. **An orphaned Extension fails every sign-up on the project.**

## If something fails

| Symptom | Cause | Fix |
|---|---|---|
| Preview stays not previewable, "repository not found" | private repo, or a typo in the URL | check the URL; ask the trainer to open the repo |
| "Connector script postDeploy failed to execute" | open **Expand** in the script log: the last line names it | most often a missing secured value, or messages not enabled |
| Deployed, but nothing happens | the sandbox is asleep, or another deployment owns the fixed key | wake `/status`; check there is only one deployment of this connector |
