# Fablo Fabric-X Integration — Design Document

**Status:** Proof of Concept  
**Author:** Nikhil  
**Related Issue:** [LFDT - Fablo: Add support for Fabric-X](https://github.com/hyperledger-labs/fablo/issues/611)

---

## 1. Problem Statement

Fabric-X introduces a more modular architecture for Hyperledger Fabric, splitting responsibilities previously handled by a single peer into multiple independent services designed for high-throughput digital asset use cases.

Running Fabric-X locally is significantly more complex than running classic Fabric with Fablo.

| | Classic Fabric | Fabric-X |
|---|---|---|
| Local setup | `fablo up` | Ansible + VMs + armageddon |
| Time to first running network | Minutes | Hours of manual setup |
| Fablo support | ✅ Available | ❌ Not yet available |

Getting a local Fabric-X network running currently requires:

1. Installing Ansible and the `hyperledger.fabricx` collection
2. Writing inventory and configuration YAML files manually
3. Running `armageddon` to generate per-node configs
4. Preparing binaries and copying them to VMs
5. Starting multiple Fabric-X services separately by hand

No simple Docker Compose based workflow exists for Fabric-X — nothing comparable to `fablo up` for classic Fabric. This POC explores whether Fablo can close that gap with a single config file.

---

## 2. Research Findings

Before writing any code, I explored the Fabric-X repositories, deployment guides, container images, and setup flow in detail. These findings directly shaped the design decisions in this document.

---

### 2.1 Fabric-X images are on GHCR, not Docker Hub

> **Finding:** Fabric-X container images are published on GitHub Container Registry. No Docker Hub images exist.

```
ghcr.io/hyperledger/fabric-x-orderer:1.0.0-alpha.1
ghcr.io/hyperledger/fabric-x-committer:1.0.0-alpha
ghcr.io/hyperledger/fabric-x-committer-test-node:1.0.0-alpha
```

No existing documentation made this clear. There were no Compose-based examples using these images, which made early local experimentation harder.

---

### 2.2 Fabric-X uses armageddon, not cryptogen

> **Finding:** Fabric-X replaces `cryptogen` + `configtxgen` with its own tool — `armageddon`.

`armageddon` is responsible for:
- Generating per-node configuration files
- Embedding cryptographic material into those configs
- Producing genesis-related configuration

This is the most significant deployment difference from classic Fabric. The entire config generation flow changes.

---

### 2.3 Each orderer party requires 4 separate config files

> **Finding:** Each orderer party needs its own set of node-specific config files, not one shared config.

```
arma-configs/
├── router_node_config.yaml
├── batcher_node_config.yaml
├── consenter_node_config.yaml
└── assembler_node_config.yaml
```

These are not simple static templates — armageddon embeds cryptographic material during generation. For this POC, placeholder configs were used to simulate the workflow locally.

---

### 2.4 `committer-test-node` solves the database problem

> **Finding:** The committer normally requires YugabyteDB or PostgreSQL 18+. The test-node image bundles everything.

```
ghcr.io/hyperledger/fabric-x-committer-test-node:1.0.0-alpha
```

This image includes YugabyteDB, sidecar services, and committer components in a single container. For local development, this eliminates a significant setup dependency.

---

### 2.5 Fabric-X still uses classic fabric-peer as endorser

> **Finding:** The endorser was not replaced by Fabric-X. Classic `fabric-peer` is still required.

```
hyperledger/fabric-peer:2.5.15
```

The major architectural changes in Fabric-X are focused on the ordering pipeline and commit flow. The endorsement step is unchanged.

---

### 2.6 Non-TLS mode is officially supported for local dev

> **Finding:** The orderer README explicitly supports a no-TLS mode for testing and demos.

> *"No TLS — Any client can submit TXs and pull blocks. This mode is only to be used in non-production settings such as testing and demonstrations."*

This simplifies local development significantly and is the right default for a Fablo-style local workflow.

---

## 3. Architecture Options Evaluated

Three integration approaches were considered before settling on a direction.

---

### Option A — Separate Repository

Create a standalone repo such as `fablo-fabric-x`.

| Pros | Cons |
|------|------|
| No risk to existing Fablo codebase | Fragments the Fablo ecosystem |
| Independent release cycle | Duplicates CLI and config infrastructure |
| Easy to experiment quickly | Hard to keep aligned with upstream Fablo |

---

### Option B — Fork of Fablo

Fork `hyperledger-labs/fablo` and add Fabric-X support inside the fork.

| Pros | Cons |
|------|------|
| Full control over architecture | Long-term maintenance burden |
| No upstream constraints | High risk of diverging from upstream |
| | Makes future synchronization difficult |

---

### Option C — Separate Engine Inside Fablo ✅ CHOSEN

Add Fabric-X support as a new engine inside the existing Fablo repository, following the same pattern as the existing `docker` and `kubernetes` engines.

| Pros | Cons |
|------|------|
| Reuses existing CLI infrastructure | Requires understanding Fablo internals |
| Keeps both workflows in one ecosystem | Fabric-X runtime is still evolving |
| Shared validation and config parsing | |
| Clean separation via engine-specific paths | |
| Fits existing `engine: "docker" \| "kubernetes"` pattern | |

> **Decision: Option C**
>
> This is exactly what maintainer @dzikowski asked for:
> *"keep the same repo, but provide a separate flow — another schema for our fablo config and separate code to handle it"*

---

## 4. Proposed Fablo Integration

The prototype follows the same high-level generation pattern already used by Fablo for classic Fabric.

---

### 4.1 Config Schema

The config extends the existing `fablo-config.json` structure with a Fabric-X engine flag:

```json
{
  "global": {
    "engine": "fabric-x",
    "fabricVersion": "1.0.0-alpha",
    "tls": false
  },
  "fabricX": {
    "orderer": {
      "type": "arma",
      "parties": 1,
      "shards": 1
    }
  },
  "orgs": [
    {
      "organization": {
        "name": "Org1",
        "domain": "org1.example.com"
      }
    }
  ]
}
```

> **Note:** The standalone POC uses a slightly different top-level schema for simplicity. The full Fablo integration would use `global.engine: "fabric-x"` as shown above to match Fablo's existing engine detection pattern.

---

### 4.2 File Structure Inside Fablo

```
src/
├── commands/
│   ├── init/
│   │   └── fabric-x.ts          ← fablo init fabric-x
│   └── validate/
│       └── fabric-x.ts          ← Fabric-X specific validation rules
├── extend-config/
│   └── extendFabricX.ts         ← extends FabloConfigExtended
├── setup-fabricx/               ← new engine (mirrors setup-docker/)
│   ├── index.ts                 ← generation entry point
│   └── templates/
│       ├── docker-compose.ejs   ← Fabric-X services
│       ├── arma-input.ejs       ← armageddon input config
│       ├── start.sh.ejs         ← lifecycle script
│       └── stop.sh.ejs          ← lifecycle script
└── types/
    ├── FabloConfigJson.ts       ← add fabricX field
    └── FabricXConfig.ts         ← new Fabric-X types
```

---

### 4.3 CLI Workflow

```bash
# Initialize a Fabric-X config
fablo init fabric-x

# Validate the config
fablo validate

# Generate docker-compose and scripts
fablo generate

# Start the network
fablo up

# Stop the network
fablo down
```

---

### 4.4 Generation Flow

```
fablo-config.json (engine: "fabric-x")
        │
        ▼
commands/validate/fabric-x.ts
  ├── BFT party count validation
  ├── Port conflict detection
  ├── Image tag format check
  └── Fabric-X specific constraints
        │
        ▼
setup-fabricx/index.ts
  ├── reads config
  ├── runs armageddon generate  ← auto-generates arma configs (Phase 2)
  ├── renders EJS templates
  └── writes output files
        │
        ▼
fablo-target/
  ├── docker-compose.yml
  ├── arma-configs/
  │   ├── router_node_config.yaml
  │   ├── batcher_node_config.yaml
  │   ├── consenter_node_config.yaml
  │   └── assembler_node_config.yaml
  ├── start.sh
  └── stop.sh
        │
        ▼
fablo up → docker compose up → Fabric-X network running
```

The generation layer is working in the current prototype. Deeper runtime integration with armageddon is the remaining gap (see Section 7).

---

## 5. Component Architecture

### 5.1 High-Level Component Flow

```
Client
  │
  ├──► Endorser (fabric-peer:2.5.15)
  │      └── executes chaincode, signs transaction proposal
  │
  └──► Arma Orderer Pipeline
         │
         ├── Router          (port 7050)
         │     accepts transactions from clients
         │     dispatches to batchers
         │
         ├── Batcher         (port 7051)
         │     groups transactions into batches
         │     sends batch attestation fragments to consenters
         │
         ├── Consenter       (port 7052)
         │     runs Arma BFT consensus
         │     produces totally ordered batch attestations
         │
         └── Assembler       (port 7053)
               creates ordered blocks from attestations
               serves blocks to committers
                      │
                      ▼
             Committer Stack (per org)
                      │
                      ├── Sidecar
                      │     pulls blocks from assembler
                      │
                      └── Committer
                            validates transactions
                            commits to ledger (YugabyteDB)
```

Fabric-X separates responsibilities that were previously bundled together inside the classic Fabric peer. The ordering and commit flows are the primary areas of change.

### 5.1.1 Full Committer Stack (Production Architecture)

In production, each org runs 5 separate committer microservices:

| Service | Role |
|---------|------|
| Sidecar | Pulls blocks from assembler, middleware to coordinator |
| Coordinator | Orchestrates the full validation pipeline |
| Validator-Committer | Optimistic concurrency control + ledger commit |
| Verification Service | Signature validation against endorsement policies |
| Query Service | Read-only state access for clients |

For this POC, `committer-test-node` bundles all 5 into one container,
making local dev possible without complex inter-service wiring and
without requiring a separate database instance.

Full microservice decomposition — using individual
`ghcr.io/hyperledger/fabric-x-committer` images — is Phase 2.

---

### 5.2 Docker Services Generated

| Service | Image | Port | Role |
|---------|-------|------|------|
| `ca.org1.example.com` | `hyperledger/fabric-ca:1.5` | 7054 | Certificate Authority |
| `endorser.org1.example.com` | `hyperledger/fabric-peer:2.5.15` | 7041 | Transaction endorsement |
| `orderer-router` | `ghcr.io/hyperledger/fabric-x-orderer:1.0.0-alpha.1` | 7050 | Client transaction intake |
| `orderer-batcher` | `ghcr.io/hyperledger/fabric-x-orderer:1.0.0-alpha.1` | 7051 | Batch creation |
| `orderer-consenter` | `ghcr.io/hyperledger/fabric-x-orderer:1.0.0-alpha.1` | 7052 | BFT consensus |
| `orderer-assembler` | `ghcr.io/hyperledger/fabric-x-orderer:1.0.0-alpha.1` | 7053 | Block assembly |
| `committer.org1.example.com` | `ghcr.io/hyperledger/fabric-x-committer-test-node:1.0.0-alpha` | 7055 | Validation + commit + embedded DB |

---

### 5.3 Startup Order

```
CA
 └──► Endorser       (depends on CA)
 └──► Router         (depends on CA)
        └──► Batcher
               └──► Consenter
                      └──► Assembler
                             └──► Committer
```

The current prototype uses Docker Compose dependency ordering. In practice, Fabric-X services likely require health-check based readiness coordination beyond simple startup ordering — particularly for the orderer pipeline once armageddon-generated configs are in place.

---

## 6. Validation Design

The validation logic follows Fablo's existing `Listener`-style pattern from `validate/index.ts`.

### 6.1 Severity Levels

```
CRITICAL  →  print immediately + process.exit(1)
ERROR     →  collect → print summary → process.exit(1)
WARN      →  collect → print summary → continue
```

### 6.2 Fabric-X Specific Rules

| Rule | Severity | Reason |
|------|----------|--------|
| `parties` must be odd | ERROR | Arma BFT cannot reach consensus with even party counts |
| `parties === 1` | WARN | Valid for local dev — no fault tolerance |
| All ports must be unique | ERROR | Docker port conflicts cause silent failures |
| Image must include explicit tag | ERROR | Untagged images cause ambiguous resolution |
| `orderer.type` must be `arma` | ERROR | Only Arma is supported in Fabric-X |
| Org name must be alphanumeric | ERROR | Spaces break Docker container naming |
| Domain must contain a dot | ERROR | Invalid domains break service discovery |

---

## 7. Known Gaps and Next Steps

### 7.1 Current Prototype Limitations

> **Gap: armageddon integration (most critical)**
>
> The Arma orderer depends on node-specific configs generated by `armageddon`. The current prototype uses placeholder configs.
>
> Full implementation would have Fablo invoke:
> ```bash
> armageddon generate \
>   --config=arma-input.yaml \
>   --output=fablo-target/arma-configs/
> ```
> This requires investigation because generated configs embed cryptographic material — it is not a simple templating step.

---

> **Gap: Genesis block generation**
>
> The orderer README states: *"If a genesis block is not found, Arma will fail to start."*
>
> It is not yet clear whether `armageddon` handles genesis block generation or whether a separate step is required. This needs to be resolved before the orderer can fully boot.

---

> **Gap: TLS support**
>
> The current prototype uses `tls: false`, which is officially supported for local testing. Production deployment will need full TLS configuration and certificate handling.

---

> **Gap: Runtime orchestration**
>
> The generation pipeline works end-to-end. Full runtime boot depends on valid armageddon-generated configs and proper service coordination. Simple container dependency ordering may not be sufficient once the full stack is running.

---

### 7.2 Prototype Progress

**What works now:**

| Status | Item |
|--------|------|
| ✅ | Config schema design |
| ✅ | TypeScript interfaces |
| ✅ | Fabric-X specific validation |
| ✅ | EJS template generation |
| ✅ | `docker-compose.yml` generation |
| ✅ | CI pipeline (build + Docker scan + e2e) |
| ✅ | Multi-org config generation |

**Phase 2 — during mentorship:**

- armageddon integration
- Genesis block generation
- `fablo init fabric-x` command
- Integration into Fablo CLI as `engine: "fabric-x"`
- TLS support
- Proper health-check based startup orchestration

**Phase 3 — future scope:**

- Multi-party BFT networks (3+ parties)
- Monitoring stack (Grafana / Prometheus)
- Chaincode / token-sdk workflow support
- Fabric-X channel management commands

---

## 8. Why This Prototype Validates the Approach

The prototype was built to answer one specific question: *can Fablo's generation pipeline be extended to support Fabric-X without restructuring the core architecture?*

The answer is yes.

| Observation | Status |
|-------------|--------|
| Config-driven generation works for Fabric-X services | ✅ Verified |
| `docker-compose.yml` produced consistently from config | ✅ Verified |
| Multi-org generation works correctly | ✅ Verified |
| Fabric-X validation catches real config constraints | ✅ Verified |
| Existing Fablo patterns (EJS, Listener, CLI structure) are reusable | ✅ Verified |
| CI proves deterministic, reproducible generation | ✅ Verified |
| Research identified the real blockers (armageddon, genesis) | ✅ Verified |

The generation layer — the hardest design problem — is solved. armageddon integration is an implementation task, not a design unknown.

---

## 9. References

- [Fabric-X Orderer Repository](https://github.com/hyperledger/fabric-x-orderer)
- [Fabric-X Committer Repository](https://github.com/hyperledger/fabric-x-committer)
- [Arma Deployment Guide](https://github.com/hyperledger/fabric-x-orderer/tree/main/deployment)
- [Fablo Repository](https://github.com/hyperledger-labs/fablo)
- [LFX Mentorship Issue #611](https://github.com/hyperledger-labs/fablo/issues/611)
- [Arma White Paper](https://ia.cr/2024/808)
- [Fabric-X Committer Test Node](https://github.com/hyperledger/fabric-x-committer/pkgs/container/fabric-x-committer-test-node)
