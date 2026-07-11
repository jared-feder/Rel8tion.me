import Link from 'next/link'
import { Check, ExternalLink, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function SetupSuccessPage() {
  return (
    <div className="rel8tion-builder-surface min-h-screen flex items-center justify-center px-4">
      <Card className="max-w-lg w-full">
        <CardHeader className="text-center">
          <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
            <Check className="w-8 h-8 text-green-600" />
          </div>
          <CardTitle className="font-serif text-2xl">Your Site is Being Built!</CardTitle>
          <CardDescription className="text-base">
            We&apos;re creating your professional real estate website now. This usually takes about 5 minutes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-2xl border border-white/70 bg-white/55 p-4">
            <h4 className="font-medium text-foreground mb-3">What happens next?</h4>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-medium shrink-0 mt-0.5">
                  1
                </div>
                <span className="text-foreground">
                  You&apos;ll receive an email when your site is ready
                </span>
              </li>
              <li className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-medium shrink-0 mt-0.5">
                  2
                </div>
                <span className="text-foreground">
                  Connect your custom domain (or use our free subdomain)
                </span>
              </li>
              <li className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-medium shrink-0 mt-0.5">
                  3
                </div>
                <span className="text-foreground">
                  Start sharing your site with clients
                </span>
              </li>
            </ul>
          </div>

          <div className="flex flex-col gap-3">
            <Button asChild className="w-full">
              <Link href="/agent/dashboard">
                Go to Dashboard
                <ArrowRight className="w-4 h-4 ml-2" />
              </Link>
            </Button>
            <Button variant="outline" asChild className="w-full">
              <Link href="/" target="_blank">
                Preview Demo Site
                <ExternalLink className="w-4 h-4 ml-2" />
              </Link>
            </Button>
          </div>

          <p className="text-center text-sm text-muted-foreground">
            Questions? Contact us at{' '}
            <a href="mailto:support@rel8tion.com" className="text-primary hover:underline">
              support@rel8tion.com
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
