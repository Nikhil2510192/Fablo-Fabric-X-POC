# Fablo Fabric-X POC

[![CI](https://github.com/Nikhil2510192/Fablo-Fabric-X-POC/actions/workflows/test.yml/badge.svg)](https://github.com/Nikhil2510192/Fablo-Fabric-X-POC/actions)

Proof of concept for adding Hyperledger Fabric-X support to Fablo.

Built as part of the LFX Mentorship application for the
[Fablo Fabric-X integration project](https://github.com/LF-Decentralized-Trust-Mentorships/mentorship-program/issues/83).

---

## The Problem

Running Fabric-X locally today:
Install Ansible + hyperledger.fabricx collection
Write inventory files manually
Run armageddon to generate per-node configs
Copy binaries to VMs
Start 4 separate processes per party manually

Running classic Fabric with Fablo today: fablo up

This POC bridges that gap for Fabric-X.

---

## What the Maintainer Asked For

@dzikowski described the approach in the issue:

> "keep the same repo, but provide a separate flow —
> another schema for our fablo config and separate
> code to handle it"

This POC implements exactly that.

---

## How This Fits Into Fablo

Fablo's architecture is a generation pipeline: fablo-config.json → validate → generate (EJS templates) → output files

Fablo already supports multiple engines this way:
fablo-config.json
└── global.engine: "docker"    → fablo-target/ (Docker Compose)
└── global.engine: "k8s"       → fablo-target/ (Kubernetes manifests)

This POC adds the Fabric-X engine following the same pattern:

fabric-x-config.json
↓
src/validate.ts       — Fabric-X specific rules (Fablo's Listener pattern)
↓
src/generate.ts       — reads config, renders EJS templates
↓
templates/
├── docker-compose.ejs
├── start.sh.ejs
└── stop.sh.ejs
↓
fablo-target-fabricx/
├── docker-compose.yml
├── start.sh
└── stop.sh
↓
./start.sh → docker compose up → Fabric-X network running

In a full integration, this wires into the existing Fablo CLI
as a new engine — triggered when user sets `engine: fabric-x`
in their fablo-config.json.

---

## What I Found During Research

Before writing a single line of code, I researched both codebases:

**No Docker Hub images**
Fabric-X images are on GitHub Container Registry (ghcr.io),
not Docker Hub. Nobody had documented this clearly.

**No existing docker-compose for Fabric-X**
No one has done this before. The only deployment method
is Ansible on VMs.

**Orderer uses armageddon, not cryptogen**
Classic Fabric uses cryptogen + configtxgen.
Fabric-X uses its own tool — armageddon — to generate
per-node config files. 4 separate config files per party.

**committer-test-node solves the DB problem**
The committer requires YugabyteDB or PostgreSQL 18+.
The committer-test-node image bundles DB + sidecar + committer
into one container — perfect for local dev.

**Fabric-X still uses classic fabric-peer as endorser**
The endorser was NOT replaced by Fabric-X.
Only the orderer and committer were redesigned.

---

## Fabric-X Architecture

Classic Fabric peer (monolith): Client → Peer (endorser + validator + committer + state) → Orderer

Fabric-X (decomposed):
Client → Endorser (fabric-peer)
→ Orderer (4 processes):
Router    — accepts transactions from clients
Batcher   — bundles transactions into batches
Consenter — BFT consensus (Arma protocol)
Assembler — creates ordered blocks
→ Committer (sidecar + validator + DB)

---

## Components

| Component | Image | Port |
|-----------|-------|------|
| CA | hyperledger/fabric-ca:1.5 | 7054 |
| Endorser | hyperledger/fabric-peer:2.5.15 | 7041 |
| Router | ghcr.io/hyperledger/fabric-x-orderer:1.0.0-alpha.1 | 7050 |
| Batcher | ghcr.io/hyperledger/fabric-x-orderer:1.0.0-alpha.1 | 7051 |
| Consenter | ghcr.io/hyperledger/fabric-x-orderer:1.0.0-alpha.1 | 7052 |
| Assembler | ghcr.io/hyperledger/fabric-x-orderer:1.0.0-alpha.1 | 7053 |
| Committer | ghcr.io/hyperledger/fabric-x-committer-test-node:1.0.0-alpha | 7055 |

---

## How to Use

```bash
# 1. Install dependencies
npm install

# 2. Write your config (or use the sample)
cp samples/fabric-x-simple.json fabric-x-config.json
# edit fabric-x-config.json as needed

# 3. Generate network files
npx ts-node src/generate.ts fabric-x-config.json

# 4. Start network
cd fablo-target-fabricx
./start.sh

# 5. Check status
docker compose ps

# 6. Stop network
./stop.sh
```

---

## Config Schema

```json
{
  "fabricX": {
    "version": "1.0.0-alpha",
    "tls": false
  },
  "network": {
    "name": "fabric-x-local",
    "orderer": {
      "type": "arma",
      "image": "ghcr.io/hyperledger/fabric-x-orderer:1.0.0-alpha.1",
      "parties": 1,
      "shards": 1,
      "ports": {
        "router": 7050,
        "batcher": 7051,
        "consenter": 7052,
        "assembler": 7053
      }
    },
    "organizations": [
      {
        "name": "Org1",
        "domain": "org1.example.com",
        "ca": {
          "image": "hyperledger/fabric-ca:1.5",
          "port": 7054
        },
        "committer": {
          "image": "ghcr.io/hyperledger/fabric-x-committer-test-node:1.0.0-alpha",
          "port": 7055
        }
      }
    ]
  }
}
```
## Sample Configs

| File | Description |
|------|-------------|
| samples/fabric-x-simple.json | 1 org, 1 party — minimal local dev |
| samples/fabric-x-multi-org.json | 2 orgs, 1 party — realistic setup |

---

## Validation Rules

Fabric-X specific rules validated before generation:

| Rule | Severity | Reason |
|------|----------|--------|
| parties must be odd | ERROR | Arma BFT cannot reach consensus with even parties |
| parties === 1 | WARN | Valid for local dev, no fault tolerance |
| all ports unique | ERROR | Docker port conflicts cause silent failures |
| image must include tag | ERROR | Docker cannot pull untagged images reliably |
| orderer.type must be arma | ERROR | Only Arma is supported in Fabric-X |
| org name alphanumeric | ERROR | Spaces break Docker container names |
| domain must contain dot | ERROR | Invalid domain breaks service discovery |

---

## CI Pipeline

Every push and pull request runs 3 jobs:

Build and Validate
├── TypeScript compile check
├── Run generation pipeline
├── Verify all output files exist
└── Validate docker-compose.yml syntax
Docker Build and Scan
├── Multi-stage Docker build
└── Trivy vulnerability scan
e2e Test
├── Full generation pipeline
├── docker compose up
├── Container status checks
└── Log scanning for critical errors

e2e test follows Fablo's existing test pattern exactly —
trap-based cleanup, waitForContainer log checks, dumpLogs on failure.

---

## Known Limitations

### Arma Config Generation

The Arma orderer requires per-node config files generated
by the armageddon CLI tool. 
In this POC, 4 placeholder configs are committed under arma-configs/:
- router_node_config.yaml
- batcher_node_config.yaml
- consenter_node_config.yaml
- assembler_node_config.yaml

Structured based on the real deployment config format from
the fabric-x-orderer repo. These are copied automatically
into fablo-target-fabricx/arma-configs/ on generate.

In a full Fablo integration:
User defines topology in fabric-x-config.json
Fablo runs armageddon generate automatically
Generated configs mounted into orderer containers

Full armageddon integration is the logical next step.

### Runtime Boot

Orderer components require correctly generated armageddon configs
to fully boot. The generation pipeline works correctly.
Runtime boot of the full network is the known gap —
expected for alpha software at this stage.

### CA Healthcheck

CA healthcheck simplified for CI compatibility.
Production deployment should use proper healthcheck
with service_healthy condition.

---

## What Works
✅ Config schema design
✅ TypeScript interfaces (types.ts)
✅ Fabric-X specific validation (validate.ts)
✅ Generation pipeline (generate.ts)
✅ docker-compose.yml generation (EJS template)
✅ start.sh / stop.sh generation
✅ Multi-stage Dockerfile
✅ GitHub Actions CI (all 3 jobs passing)
✅ e2e test following Fablo's pattern

## What's Next
⬜ armageddon integration — auto-generate orderer configs
⬜ Genesis block generation
⬜ TLS support
⬜ Multi-party network support
⬜ Integration into Fablo CLI as fabric-x engine
⬜ fablo init fabric-x command

---

## Why This Approach

Three options were evaluated:

| Option | Description | Chosen? |
|--------|-------------|---------|
| A | New standalone tool | No — disconnected from Fablo |
| B | Fork of Fablo | No — maintenance burden |
| C | Separate engine inside Fablo | ✅ Yes |

For full architecture details, integration plan, and research findings see [DESIGN.md](./DESIGN.md).
Option C chosen because it matches the maintainer's guidance,
follows existing Fablo patterns, and doesn't break any existing flows.