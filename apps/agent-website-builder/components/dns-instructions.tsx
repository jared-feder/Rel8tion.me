'use client'

import { useState } from 'react'
import { Copy, Check, ExternalLink, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface DNSInstructionsProps {
  domain: string
  registrar?: 'hostinger' | 'godaddy' | 'namecheap' | 'other'
}

export function DNSInstructions({ domain, registrar = 'other' }: DNSInstructionsProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const dnsRecords = [
    { type: 'A', name: '@', value: '76.76.21.21', description: 'Points root domain to Vercel' },
    { type: 'CNAME', name: 'www', value: 'cname.vercel-dns.com', description: 'Points www subdomain to Vercel' },
  ]

  const registrarLinks: Record<string, string> = {
    hostinger: 'https://www.hostinger.com/tutorials/how-to-change-dns-records',
    godaddy: 'https://www.godaddy.com/help/manage-dns-records-680',
    namecheap: 'https://www.namecheap.com/support/knowledgebase/article.aspx/319/2237/how-can-i-set-up-an-a-address-record-for-my-domain/',
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">DNS Configuration for {domain}</CardTitle>
        <CardDescription>
          Add these records in your domain registrar to connect your custom domain
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            DNS changes can take up to 48 hours to propagate, but usually complete within 1-2 hours.
          </AlertDescription>
        </Alert>

        <div className="space-y-3">
          <p className="text-sm font-medium text-foreground">Required DNS Records:</p>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Type</th>
                  <th className="px-3 py-2 text-left font-medium">Name/Host</th>
                  <th className="px-3 py-2 text-left font-medium">Value/Points to</th>
                  <th className="px-3 py-2 text-right font-medium">Copy</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {dnsRecords.map((record) => (
                  <tr key={record.type + record.name} className="bg-background">
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                        {record.type}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs">{record.name}</td>
                    <td className="px-3 py-2.5 font-mono text-xs">{record.value}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => copyToClipboard(record.value, record.type)}
                      >
                        {copiedField === record.type ? (
                          <Check className="h-3.5 w-3.5 text-green-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="pt-2 space-y-2">
          <p className="text-sm font-medium text-foreground">Quick Links:</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={registrarLinks.hostinger} target="_blank" rel="noopener noreferrer">
                Hostinger Guide <ExternalLink className="ml-1.5 h-3 w-3" />
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={registrarLinks.godaddy} target="_blank" rel="noopener noreferrer">
                GoDaddy Guide <ExternalLink className="ml-1.5 h-3 w-3" />
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={registrarLinks.namecheap} target="_blank" rel="noopener noreferrer">
                Namecheap Guide <ExternalLink className="ml-1.5 h-3 w-3" />
              </a>
            </Button>
          </div>
        </div>

        <div className="pt-2 border-t">
          <p className="text-xs text-muted-foreground">
            <strong>Alternative:</strong> You can also use Vercel nameservers for easier setup. 
            Change your domain&apos;s nameservers to <code className="bg-muted px-1 rounded">ns1.vercel-dns.com</code> and{' '}
            <code className="bg-muted px-1 rounded">ns2.vercel-dns.com</code>
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
