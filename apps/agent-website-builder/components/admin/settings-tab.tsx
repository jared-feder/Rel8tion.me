'use client'

import { useEffect, useState } from 'react'
import { CheckCircle, Loader2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'

const SETTINGS_KEY = 'rel8tion_builder_settings'

export function SettingsTab() {
  const [settings, setSettings] = useState({
    companyName: 'REL8TION Sites',
    supportEmail: 'support@rel8tion.me',
    defaultDomain: 'my.rel8tion.me',
    enableNotifications: true,
    enableAutoPublish: true,
  })
  const [status, setStatus] = useState('')
  const [isTesting, setIsTesting] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem(SETTINGS_KEY)
    if (saved) {
      setSettings((current) => ({ ...current, ...JSON.parse(saved) }))
    }
  }, [])

  const handleSave = () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    setStatus('Settings saved for this browser.')
  }

  const testConnection = async () => {
    setIsTesting(true)
    setStatus('')
    try {
      const response = await fetch('/api/brands', { cache: 'no-store' })
      const data = await response.json()
      const rel8tionCount = Number(data.rel8tion_count || 0)
      setStatus(`Connection checked. ${rel8tionCount} REL8TION brokerage brand${rel8tionCount === 1 ? '' : 's'} available.`)
    } catch {
      setStatus('Connection test failed. Check REL8TION Supabase env vars.')
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>General Settings</CardTitle>
          <CardDescription>Defaults used by the website builder UI.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="companyName">Company Name</Label>
            <Input
              id="companyName"
              value={settings.companyName}
              onChange={(event) => setSettings({ ...settings, companyName: event.target.value })}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="supportEmail">Support Email</Label>
            <Input
              id="supportEmail"
              type="email"
              value={settings.supportEmail}
              onChange={(event) => setSettings({ ...settings, supportEmail: event.target.value })}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="defaultDomain">Default Domain</Label>
            <Input
              id="defaultDomain"
              value={settings.defaultDomain}
              onChange={(event) => setSettings({ ...settings, defaultDomain: event.target.value })}
              className="mt-1.5"
            />
            <p className="text-xs text-muted-foreground mt-1">
              New sites are displayed as [agent-slug].{settings.defaultDomain} or {settings.defaultDomain}/[agent-slug], depending on deployment routing.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>REL8TION Brand Connection</CardTitle>
          <CardDescription>
            Brokerages are loaded from the REL8TION `brokerages` table through `/api/brands`.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md bg-muted/50 p-4 text-sm text-muted-foreground">
            Required env vars: `REL8TION_SUPABASE_URL` and `REL8TION_SUPABASE_ANON_KEY`.
            Site persistence also needs `SUPABASE_SERVICE_ROLE_KEY`.
          </div>
          <Button variant="outline" size="sm" onClick={testConnection} disabled={isTesting}>
            {isTesting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
            Test Brand Connection
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Publishing Behavior</CardTitle>
          <CardDescription>Controls how newly created sites are handled.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="notifications" className="font-medium">Email Notifications</Label>
              <p className="text-sm text-muted-foreground">Reserve this for signup and domain events.</p>
            </div>
            <Switch
              id="notifications"
              checked={settings.enableNotifications}
              onCheckedChange={(checked) => setSettings({ ...settings, enableNotifications: checked })}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="autoPublish" className="font-medium">Auto-Publish Sites</Label>
              <p className="text-sm text-muted-foreground">Create default-domain sites as published immediately.</p>
            </div>
            <Switch
              id="autoPublish"
              checked={settings.enableAutoPublish}
              onCheckedChange={(checked) => setSettings({ ...settings, enableAutoPublish: checked })}
            />
          </div>
        </CardContent>
      </Card>

      {status && (
        <div className="rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground">{status}</div>
      )}

      <div className="flex justify-end">
        <Button onClick={handleSave}>
          <Save className="h-4 w-4 mr-2" />
          Save Settings
        </Button>
      </div>
    </div>
  )
}
