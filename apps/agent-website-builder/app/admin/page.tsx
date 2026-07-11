'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, Lock } from 'lucide-react'
import { Sidebar, AdminHeader } from '@/components/admin/sidebar'
import { DashboardTab } from '@/components/admin/dashboard-tab'
import { AgentsTab } from '@/components/admin/agents-tab'
import { ListingsTab } from '@/components/admin/listings-tab'
import { LeadsTab } from '@/components/admin/leads-tab'
import { AiStudioTab } from '@/components/admin/ai-studio-tab'
import { SitesTab } from '@/components/admin/sites-tab'
import { BillingTab } from '@/components/admin/billing-tab'
import { SettingsTab } from '@/components/admin/settings-tab'

const tabTitles: Record<string, { title: string; subtitle?: string }> = {
  dashboard: { title: 'Dashboard', subtitle: 'Overview of your REL8TION sites' },
  agents: { title: 'Agents', subtitle: 'Manage your real estate agent profiles' },
  listings: { title: 'Listings', subtitle: 'Add and manage agent-owned website listings' },
  leads: { title: 'Leads', subtitle: 'Review website lead submissions and follow up fast' },
  ai: { title: 'AI Studio', subtitle: 'Create listing media that carries the REL8TION brand' },
  sites: { title: 'Sites', subtitle: 'Manage published websites and domains' },
  billing: { title: 'Billing', subtitle: 'Manage your subscription and payments' },
  settings: { title: 'Settings', subtitle: 'Configure your account preferences' },
}

export default function AdminPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('dashboard')
  const [addAgentRequest, setAddAgentRequest] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function verifyStoredAuth() {
      const auth = localStorage.getItem('admin_auth')
      if (auth !== 'true') {
        if (!cancelled) setIsLoading(false)
        return
      }

      try {
        const response = await fetch('/api/admin/sites', { cache: 'no-store' })
        if (response.status === 401) {
          localStorage.removeItem('admin_auth')
          if (!cancelled) {
            setError('Please sign in again.')
            setIsAuthenticated(false)
          }
          return
        }

        if (!cancelled) setIsAuthenticated(true)
      } catch {
        if (!cancelled) setIsAuthenticated(true)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    verifyStoredAuth()
    return () => {
      cancelled = true
    }
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Invalid password')
      }
      localStorage.setItem('admin_auth', 'true')
      setIsAuthenticated(true)
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Unable to sign in')
    }
  }

  const handleLogout = () => {
    fetch('/api/admin/login', { method: 'DELETE' }).catch(() => null)
    localStorage.removeItem('admin_auth')
    setIsAuthenticated(false)
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="rel8tion-builder-surface min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Login form
  if (!isAuthenticated) {
    return (
      <div className="rel8tion-builder-surface min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="rel8tion-logo-mark mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl">
              <Lock className="h-6 w-6 text-white" />
            </div>
            <CardTitle className="text-2xl">REL8TION Admin</CardTitle>
            <CardDescription>Enter your password to access the dashboard</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter admin password"
                  autoFocus
                />
              </div>
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
              <Button type="submit" className="w-full">
                Sign In
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Dashboard
  const renderTabContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <DashboardTab />
      case 'agents':
        return <AgentsTab addAgentRequest={addAgentRequest} />
      case 'listings':
        return <ListingsTab />
      case 'leads':
        return <LeadsTab />
      case 'ai':
        return <AiStudioTab />
      case 'sites':
        return <SitesTab />
      case 'billing':
        return <BillingTab />
      case 'settings':
        return <SettingsTab />
      default:
        return <DashboardTab />
    }
  }

  return (
    <div className="rel8tion-builder-surface min-h-screen">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} onLogout={handleLogout} />
      <main className="lg:ml-64 pt-16 lg:pt-0">
        <div className="p-6 lg:p-8">
          <AdminHeader
            title={tabTitles[activeTab]?.title || 'Dashboard'}
            subtitle={tabTitles[activeTab]?.subtitle}
            onAddAgent={() => {
              setActiveTab('agents')
              setAddAgentRequest((value) => value + 1)
            }}
          />
          {renderTabContent()}
        </div>
      </main>
    </div>
  )
}
