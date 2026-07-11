import 'server-only'

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { AgentWebsite } from '@/lib/builder'

const storePath = path.join(process.cwd(), '.local-data', 'agent-websites.json')

async function ensureStore() {
  await fs.mkdir(path.dirname(storePath), { recursive: true })
  try {
    await fs.access(storePath)
  } catch {
    await fs.writeFile(storePath, '[]', 'utf8')
  }
}

export async function readLocalSites(): Promise<AgentWebsite[]> {
  await ensureStore()
  const raw = await fs.readFile(storePath, 'utf8')
  return JSON.parse(raw) as AgentWebsite[]
}

export async function writeLocalSites(sites: AgentWebsite[]) {
  await ensureStore()
  await fs.writeFile(storePath, JSON.stringify(sites, null, 2), 'utf8')
}

export async function createLocalSite(site: Omit<AgentWebsite, 'id' | 'created_at' | 'updated_at' | 'views'>) {
  const sites = await readLocalSites()
  const now = new Date().toISOString()
  let slug = site.slug
  let suffix = 2
  while (sites.some((existing) => existing.slug === slug)) {
    slug = `${site.slug}-${suffix}`
    suffix += 1
  }
  const newSite: AgentWebsite = {
    ...site,
    slug,
    id: crypto.randomUUID(),
    views: 0,
    created_at: now,
    updated_at: now,
  }
  await writeLocalSites([newSite, ...sites])
  return newSite
}

export async function updateLocalSite(id: string, patch: Partial<AgentWebsite>) {
  const sites = await readLocalSites()
  const now = new Date().toISOString()
  let updatedSite: AgentWebsite | null = null
  const updatedSites = sites.map((site) => {
    if (site.id !== id) return site
    updatedSite = { ...site, ...patch, updated_at: now }
    return updatedSite
  })
  await writeLocalSites(updatedSites)
  return updatedSite
}

export async function deleteLocalSite(id: string) {
  const sites = await readLocalSites()
  await writeLocalSites(sites.filter((site) => site.id !== id))
}
