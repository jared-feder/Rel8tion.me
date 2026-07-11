import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Admin Dashboard | REL8TION Site Manager',
  description: 'Manage your real estate agent website templates',
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-muted/30">
      {children}
    </div>
  )
}
