import { FabricXConfig, Orderer, Organization } from './types'

// ── Matches Fablo's exact pattern ────────────────────────

interface Message {
  category: string
  message: string
}

class Listener {
  readonly messages: Message[] = []

  onEvent(event: Message) {
    this.messages.push(event)
  }

  count() {
    return this.messages.length
  }

  getAllMessages() {
    return this.messages
  }
}

const validationErrorType = {
  CRITICAL: 'validation-critical',
  ERROR: 'validation-error',
  WARN: 'validation-warning'
}

const validationCategories = {
  CRITICAL: 'Critical',
  ORDERER: 'Orderer',
  NETWORK: 'Network',
  ORGANIZATIONS: 'Organizations',
  PORTS: 'Ports'
}

// ── Validator class ──────────────────────────────────────

export class Validator {
  private readonly errors = new Listener()
  private readonly warnings = new Listener()

  private emit(type: string, event: Message) {
    if (type === validationErrorType.CRITICAL) {
      console.error(`\n❌ Critical error: ${event.message}`)
      process.exit(1)
    } else if (type === validationErrorType.ERROR) {
      this.errors.onEvent(event)
    } else if (type === validationErrorType.WARN) {
      this.warnings.onEvent(event)
    }
  }

  // ── Validation rules ────────────────────────────────

  _validateTopLevel(config: FabricXConfig) {
    if (!config.fabricX) {
      this.emit(validationErrorType.CRITICAL, {
        category: validationCategories.CRITICAL,
        message: 'Missing required field: fabricX'
      })
    }
    if (!config.network) {
      this.emit(validationErrorType.CRITICAL, {
        category: validationCategories.CRITICAL,
        message: 'Missing required field: network'
      })
    }
    if (!config.network.name) {
      this.emit(validationErrorType.CRITICAL, {
        category: validationCategories.CRITICAL,
        message: 'Missing required field: network.name'
      })
    }
  }

  _validateOrdererType(orderer: Orderer) {
    if (orderer.type !== 'arma') {
      this.emit(validationErrorType.ERROR, {
        category: validationCategories.ORDERER,
        message: `Unsupported orderer type: '${orderer.type}'. Fabric-X only supports 'arma'`
      })
    }
  }

  _validateBFTPartyCount(orderer: Orderer) {
    if (orderer.parties % 2 === 0) {
      this.emit(validationErrorType.ERROR, {
        category: validationCategories.ORDERER,
        message: `Arma BFT requires odd number of parties. Got: ${orderer.parties}. Use 1, 3, 5...`
      })
    }
    if (orderer.parties === 1) {
      this.emit(validationErrorType.WARN, {
        category: validationCategories.ORDERER,
        message: `Single party network — no fault tolerance. Fine for local dev.`
      })
    }
    if (orderer.shards < 1) {
      this.emit(validationErrorType.ERROR, {
        category: validationCategories.ORDERER,
        message: `orderer.shards must be >= 1. Got: ${orderer.shards}`
      })
    }
  }

  _validateImageTags(config: FabricXConfig) {
    const images = [
      { name: 'orderer.image', value: config.network.orderer.image },
      ...config.network.organizations.map(o => ({
        name: `${o.name}.ca.image`,
        value: o.ca.image
      })),
      ...config.network.organizations.map(o => ({
        name: `${o.name}.committer.image`,
        value: o.committer.image
      }))
    ]

    images.forEach(({ name, value }) => {
      if (!value.includes(':')) {
        this.emit(validationErrorType.ERROR, {
          category: validationCategories.NETWORK,
          message: `Image missing tag: '${name}' = '${value}'. Use format image:tag`
        })
      }
    })
  }

  _validatePortConflicts(config: FabricXConfig) {
    const allPorts = [
      { name: 'orderer.router', value: config.network.orderer.ports.router },
      { name: 'orderer.batcher', value: config.network.orderer.ports.batcher },
      { name: 'orderer.consenter', value: config.network.orderer.ports.consenter },
      { name: 'orderer.assembler', value: config.network.orderer.ports.assembler },
      ...config.network.organizations.map(o => ({
        name: `${o.name}.ca`,
        value: o.ca.port
      })),
      ...config.network.organizations.map(o => ({
        name: `${o.name}.committer`,
        value: o.committer.port
      }))
    ]

    const portValues = allPorts.map(p => p.value)
    const duplicates = allPorts.filter(
      (p, i) => portValues.indexOf(p.value) !== i
    )

    if (duplicates.length > 0) {
      this.emit(validationErrorType.ERROR, {
        category: validationCategories.PORTS,
        message: `Duplicate ports found: ${duplicates.map(d => `${d.name}:${d.value}`).join(', ')}`
      })
    }
  }

  _validateOrgNames(orgs: Organization[]) {
    orgs.forEach(org => {
      if (!/^[a-zA-Z0-9]+$/.test(org.name)) {
        this.emit(validationErrorType.ERROR, {
          category: validationCategories.ORGANIZATIONS,
          message: `Org name '${org.name}' invalid. Use alphanumeric only — no spaces or special characters`
        })
      }
      if (!org.domain.includes('.')) {
        this.emit(validationErrorType.ERROR, {
          category: validationCategories.ORGANIZATIONS,
          message: `Org domain '${org.domain}' invalid. Must contain at least one dot. Example: org1.example.com`
        })
      }
    })
  }

  _validateOrgsExist(config: FabricXConfig) {
    if (!config.network.organizations?.length) {
      this.emit(validationErrorType.ERROR, {
        category: validationCategories.ORGANIZATIONS,
        message: 'At least one organization is required'
      })
    }
  }

  // ── Summary output ──────────────────────────────────

  printSummary() {
    if (this.errors.count() > 0) {
      console.error('\n❌ Errors found:')
      this.errors.getAllMessages().forEach(m => {
        console.error(`   [${m.category}] ${m.message}`)
      })
    }

    if (this.warnings.count() > 0) {
      console.warn('\n⚠️  Warnings:')
      this.warnings.getAllMessages().forEach(m => {
        console.warn(`   [${m.category}] ${m.message}`)
      })
    }

    if (this.errors.count() > 0) {
      process.exit(1)
    }
  }

  // ── Main validate entry point ───────────────────────

  validate(config: FabricXConfig): void {
    console.log('🔍 Validating Fabric-X config...')

    this._validateTopLevel(config)
    this._validateOrdererType(config.network.orderer)
    this._validateBFTPartyCount(config.network.orderer)
    this._validateImageTags(config)
    this._validatePortConflicts(config)
    this._validateOrgNames(config.network.organizations)
    this._validateOrgsExist(config)

    this.printSummary()

    console.log('✅ Config validation passed\n')
  }
}