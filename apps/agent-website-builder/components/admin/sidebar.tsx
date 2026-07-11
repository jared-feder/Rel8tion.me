'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Users,
  Clapperboard,
  Home,
  Inbox,
  HousePlus,
  Settings,
  CreditCard,
  LogOut,
  Menu,
  X,
  Plus,
  LayoutDashboard,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface SidebarProps {
  activeTab: string
  setActiveTab: (tab: string) => void
  onLogout?: () => void
}

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'agents', label: 'Agents', icon: Users },
  { id: 'listings', label: 'Listings', icon: HousePlus },
  { id: 'leads', label: 'Leads', icon: Inbox },
  { id: 'ai', label: 'AI Studio', icon: Clapperboard },
  { id: 'sites', label: 'Sites', icon: Home },
  { id: 'billing', label: 'Billing', icon: CreditCard },
  { id: 'settings', label: 'Settings', icon: Settings },
]

export function Sidebar({ activeTab, setActiveTab, onLogout }: SidebarProps) {
  const [isMobileOpen, setIsMobileOpen] = useState(false)

  return (
    <>
      {/* Mobile Header */}
      <div className="rel8tion-builder-header lg:hidden fixed top-0 left-0 right-0 h-16 z-50 flex items-center justify-between px-4">
        <Link href="/admin" className="font-bold text-lg text-foreground">
          REL8TION Admin
        </Link>
        <button
          onClick={() => setIsMobileOpen(!isMobileOpen)}
          className="p-2 text-foreground"
        >
          {isMobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Mobile Overlay */}
      {isMobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'rel8tion-admin-sidebar fixed top-0 left-0 h-full w-64 z-50 transition-transform duration-300',
          'lg:translate-x-0',
          isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        <div className="p-6 border-b border-white/70">
          <Link href="/admin" className="flex items-center gap-2">
            <div className="rel8tion-logo-mark p-2 rounded-xl">
              <Home className="h-5 w-5 text-white" />
            </div>
            <span className="font-bold text-lg text-foreground">REL8TION</span>
          </Link>
        </div>

        <nav className="p-4 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setActiveTab(item.id)
                setIsMobileOpen(false)
              }}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors',
                activeTab === item.id
                  ? 'bg-primary text-primary-foreground shadow-[0_14px_30px_rgba(20,92,242,0.18)]'
                  : 'text-muted-foreground hover:bg-white/70 hover:text-foreground'
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-white/70">
          <Button 
            variant="ghost" 
            className="w-full justify-start gap-3 text-muted-foreground"
            onClick={onLogout}
          >
            <LogOut className="h-5 w-5" />
            Sign Out
          </Button>
        </div>
      </aside>
    </>
  )
}

export function AdminHeader({
  title,
  subtitle,
  onAddAgent,
}: {
  title: string
  subtitle?: string
  onAddAgent?: () => void
}) {
  return (
    <div className="flex items-center justify-between mb-8">
      <div>
        <h1 className="text-2xl font-black text-foreground">{title}</h1>
        {subtitle && <p className="text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      <Button onClick={onAddAgent}>
        <Plus className="h-4 w-4 mr-2" />
        Add New Agent
      </Button>
    </div>
  )
}
