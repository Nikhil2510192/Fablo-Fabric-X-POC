import fs from 'fs'
import path from 'path'
import ejs from 'ejs'
import { Validator } from './validate'
import { FabricXConfig } from './types'

// ── 1. Read config path from command line ────────────────
const configPath = process.argv[2]
if (!configPath) {
  console.error('❌ Usage: ts-node src/generate.ts <config-file>')
  console.error('   Example: ts-node src/generate.ts samples/fabric-x-simple.json')
  process.exit(1)
}

// ── 2. Read and parse config ─────────────────────────────
console.log(`📖 Reading config: ${configPath}`)

let config: FabricXConfig
try {
  const raw = fs.readFileSync(configPath, 'utf8')
  config = JSON.parse(raw)
} catch (err) {
  console.error(`❌ Failed to read config file: ${configPath}`)
  console.error(err)
  process.exit(1)
}

// ── 3. Validate ──────────────────────────────────────────
const validator = new Validator()
validator.validate(config)

// ── 4. Create output directory ───────────────────────────
const outputDir = './fablo-target-fabricx'
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true })
}
console.log(`📁 Output directory: ${outputDir}`)

// ── 5. Render templates ──────────────────────────────────
const templates = [
  { template: 'docker-compose.ejs', output: 'docker-compose.yml' },
  { template: 'start.sh.ejs',       output: 'start.sh'           },
  { template: 'stop.sh.ejs',        output: 'stop.sh'            }
]

templates.forEach(({ template, output }) => {
  const templatePath = path.join('./templates', template)
  const templateContent = fs.readFileSync(templatePath, 'utf8')
  const rendered = ejs.render(templateContent, { config })
  const outputPath = path.join(outputDir, output)
  fs.writeFileSync(outputPath, rendered)
  console.log(`✅ Generated: ${outputPath}`)
})

// ── 6. Copy pre-generated arma configs ──────────────────
const armaConfigsDir = './arma-configs'
const armaOutputDir = path.join(outputDir, 'arma-configs')

if (fs.existsSync(armaConfigsDir)) {
  if (!fs.existsSync(armaOutputDir)) {
    fs.mkdirSync(armaOutputDir, { recursive: true })
  }
  const armaFiles = fs.readdirSync(armaConfigsDir)
  armaFiles.forEach(file => {
    const src = path.join(armaConfigsDir, file)
    const dest = path.join(armaOutputDir, file)
    fs.copyFileSync(src, dest)
    console.log(`✅ Copied arma config: ${dest}`)
  })
} else {
  console.warn('⚠️  arma-configs/ directory not found — orderer configs not copied')
}

// ── 7. Make shell scripts executable ────────────────────
try {
  fs.chmodSync(`${outputDir}/start.sh`, '755')
  fs.chmodSync(`${outputDir}/stop.sh`, '755')
} catch {
  // Windows doesn't support chmod — safe to ignore
}

// ── 8. Print success ─────────────────────────────────────
console.log('\n🎉 Fabric-X config generated successfully')
console.log(`📁 Output directory: ${outputDir}/`)
console.log('\nNext steps:')
console.log(`  cd ${outputDir}`)
console.log('  ./start.sh')