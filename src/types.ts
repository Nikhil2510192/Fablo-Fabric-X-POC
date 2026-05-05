export interface OrdererPorts {
  router: number
  batcher: number
  consenter: number
  assembler: number
}

export interface Orderer {
  type: 'arma'
  image: string
  parties: number
  shards: number
  ports: OrdererPorts
}

export interface CA {
  image: string
  port: number
}

export interface Committer {
  image: string
  port: number
}

export interface Organization {
  name: string
  domain: string
  ca: CA
  committer: Committer
}

export interface FabricXGlobal {
  version: string
  tls: boolean
}

export interface Network {
  name: string
  orderer: Orderer
  organizations: Organization[]
}

export interface FabricXConfig {
  fabricX: FabricXGlobal
  network: Network
}