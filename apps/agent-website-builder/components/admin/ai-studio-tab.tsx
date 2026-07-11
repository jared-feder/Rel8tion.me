'use client'

import { type ChangeEvent, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Clapperboard,
  Download,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Sparkles,
  UserRound,
  Wand2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  AI_MEDIA_MODE_OPTIONS,
  AUTO_REEL_POST_PRESETS,
  AUTO_REEL_STYLE_PRESETS,
  HEADSHOT_BACKGROUND_PRESETS,
  HEADSHOT_LOOK_PRESETS,
  STAGING_ROOM_PRESETS,
  STAGING_STYLE_PRESETS,
} from '@/lib/ai-presets'
import type { AiMediaMode } from '@/lib/ai-presets'
import { AgentWebsite } from '@/lib/builder'

interface MediaItem {
  id: string
  media_type: AiMediaMode
  status: string
  source_url: string | null
  result_url: string | null
  openai_id: string | null
  prompt: string
  caption: string | null
  error: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

interface SitesResponse {
  sites: AgentWebsite[]
}

interface MediaResponse {
  media: MediaItem[]
  error?: string
}

interface AiStudioTabProps {
  fixedSite?: AgentWebsite | null
  mediaEndpoint?: string
  statusEndpoint?: string
  sitesEndpoint?: string
  showSiteSelector?: boolean
  title?: string
}

const modeIcons: Record<AiMediaMode, typeof UserRound> = {
  agent_headshot: UserRound,
  staging_image: Wand2,
  social_video: Clapperboard,
}

const uploadLabels: Record<AiMediaMode, string> = {
  agent_headshot: 'Current Headshot or Selfie',
  staging_image: 'Room Image',
  social_video: 'Listing Images',
}

const submitLabels: Record<AiMediaMode, string> = {
  agent_headshot: 'Create Headshot',
  staging_image: 'Create Staging Render',
  social_video: 'Start AutoReel',
}

const successLabels: Record<AiMediaMode, string> = {
  agent_headshot: 'Headshot concept created.',
  staging_image: 'Staging render created.',
  social_video: 'AutoReel job started.',
}

const mediaLabels: Record<AiMediaMode, string> = {
  agent_headshot: 'Headshot',
  staging_image: 'Staging',
  social_video: 'AutoReel',
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function statusClass(status: string) {
  if (status === 'completed') return 'bg-green-500/10 text-green-700 border-green-200'
  if (status === 'failed') return 'bg-destructive/10 text-destructive border-destructive/30'
  return 'bg-amber-500/10 text-amber-700 border-amber-200'
}

function previewClass(mediaType: AiMediaMode) {
  if (mediaType === 'social_video') return 'aspect-[9/16]'
  if (mediaType === 'agent_headshot') return 'aspect-square'
  return 'aspect-[4/5]'
}

function fileBaseName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '').replace(/[^a-z0-9-]+/gi, '-').replace(/(^-|-$)/g, '') || 'listing-image'
}

async function compressImageForUpload(file: File, mode: AiMediaMode) {
  if (typeof document === 'undefined') return file

  const makeFile = async (source: CanvasImageSource, width: number, height: number, quality: number) => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width))
    canvas.height = Math.max(1, Math.round(height))
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(source, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob) return null
    return new File([blob], `${fileBaseName(file.name)}-autoreel.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    })
  }

  const imageUrl = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error(`Unable to read ${file.name || 'image'}.`))
      img.src = imageUrl
    })

    const maxSide = mode === 'social_video' ? 1280 : 1600
    const targetBytes = mode === 'social_video' ? 950_000 : 1_400_000
    const firstScale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight))
    const firstPass = await makeFile(image, image.naturalWidth * firstScale, image.naturalHeight * firstScale, 0.72)
    if (firstPass && firstPass.size <= targetBytes) return firstPass

    const secondScale = Math.min(1, 960 / Math.max(image.naturalWidth, image.naturalHeight))
    return (await makeFile(image, image.naturalWidth * secondScale, image.naturalHeight * secondScale, 0.64)) || firstPass || file
  } finally {
    URL.revokeObjectURL(imageUrl)
  }
}

export function AiStudioTab({
  fixedSite = null,
  mediaEndpoint = '/api/admin/ai-media',
  statusEndpoint = '/api/admin/ai-media/status',
  sitesEndpoint = '/api/admin/sites',
  showSiteSelector = true,
  title = 'AI Studio',
}: AiStudioTabProps = {}) {
  const [sites, setSites] = useState<AgentWebsite[]>([])
  const [media, setMedia] = useState<MediaItem[]>([])
  const [selectedSiteId, setSelectedSiteId] = useState(fixedSite?.id || '')
  const [mode, setMode] = useState<AiMediaMode>('agent_headshot')
  const [propertyAddress, setPropertyAddress] = useState('')
  const [headshotLook, setHeadshotLook] = useState(HEADSHOT_LOOK_PRESETS[0].key)
  const [headshotBackground, setHeadshotBackground] = useState(HEADSHOT_BACKGROUND_PRESETS[0].key)
  const [stagingStyle, setStagingStyle] = useState(STAGING_STYLE_PRESETS[0].key)
  const [roomType, setRoomType] = useState(STAGING_ROOM_PRESETS[0].key)
  const [videoPreset, setVideoPreset] = useState(AUTO_REEL_POST_PRESETS[0].key)
  const [videoStyle, setVideoStyle] = useState(AUTO_REEL_STYLE_PRESETS[0].key)
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [checkingId, setCheckingId] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [statusMessage, setStatusMessage] = useState('')

  useEffect(() => {
    async function load() {
      try {
        if (fixedSite) {
          const mediaResponse = await fetch(mediaEndpoint, { cache: 'no-store' })
          const mediaData: MediaResponse = await mediaResponse.json()
          setSites([fixedSite])
          setSelectedSiteId(fixedSite.id)
          setMedia(mediaData.media || [])
          return
        }

        const [sitesResponse, mediaResponse] = await Promise.all([
          fetch(sitesEndpoint, { cache: 'no-store' }),
          fetch(mediaEndpoint, { cache: 'no-store' }),
        ])
        const sitesData: SitesResponse = await sitesResponse.json()
        const mediaData: MediaResponse = await mediaResponse.json()
        setSites(sitesData.sites || [])
        setMedia(mediaData.media || [])
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Unable to load AI Studio.')
      }
    }

    load()
  }, [fixedSite, mediaEndpoint, sitesEndpoint])

  const selectedSite = useMemo(
    () => fixedSite || sites.find((site) => site.id === selectedSiteId) || null,
    [fixedSite, selectedSiteId, sites],
  )
  const needsPropertyAddress = mode !== 'agent_headshot'

  const handleImageSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files || [])
    const limited = mode === 'social_video' ? selected.slice(0, 6) : selected.slice(0, 1)
    try {
      const prepared = await Promise.all(limited.map((file) => compressImageForUpload(file, mode)))
      setImageFiles(prepared)
      setErrorMessage(selected.length > limited.length ? 'AutoReel uses up to 6 listing images per video.' : '')
    } catch (error) {
      setImageFiles([])
      setErrorMessage(error instanceof Error ? error.message : 'Unable to prepare selected image.')
    }
  }

  const createMedia = async () => {
    if (!imageFiles.length) {
      setErrorMessage(`Upload a ${uploadLabels[mode].toLowerCase()} first.`)
      return
    }

    setIsSubmitting(true)
    setErrorMessage('')
    setStatusMessage('')

    try {
      const body = new FormData()
      imageFiles.forEach((file) => body.append('images', file))
      body.append('image', imageFiles[0])
      body.append('mode', mode)
      body.append('agentWebsiteId', selectedSite?.id || '')
      body.append('agentName', selectedSite?.name || '')
      body.append('propertyAddress', propertyAddress)
      body.append('headshotLook', headshotLook)
      body.append('headshotBackground', headshotBackground)
      body.append('stagingStyle', stagingStyle)
      body.append('roomType', roomType)
      body.append('videoPreset', videoPreset)
      body.append('videoStyle', videoStyle)

      const response = await fetch(mediaEndpoint, {
        method: 'POST',
        body,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.media) throw new Error(data.error || 'Unable to create AI media.')

      setMedia((current) => [data.media, ...current.filter((item) => item.id !== data.media.id)])
      setStatusMessage(successLabels[mode])
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to create AI media.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const checkStatus = async (item: MediaItem) => {
    setCheckingId(item.id)
    setErrorMessage('')

    try {
      const response = await fetch(statusEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.media) throw new Error(data.error || 'Unable to check AutoReel status.')
      setMedia((current) => current.map((mediaItem) => (mediaItem.id === data.media.id ? data.media : mediaItem)))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to check AutoReel status.')
    } finally {
      setCheckingId('')
    }
  }

  const copyCaption = async (caption: string) => {
    await navigator.clipboard.writeText(caption)
    setStatusMessage('Caption copied.')
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,440px)_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-medium">
            <Sparkles className="h-5 w-5 text-primary" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {showSiteSelector ? (
            <div>
            <Label>Agent Site</Label>
            <select
              value={selectedSiteId}
              onChange={(event) => setSelectedSiteId(event.target.value)}
              className="mt-1.5 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
            >
              <option value="">REL8TION brand only</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
            </div>
          ) : selectedSite ? (
            <div className="rounded-xl border border-white/70 bg-white/60 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agent Site</p>
              <p className="font-semibold text-foreground">{selectedSite.name}</p>
              <p className="text-sm text-muted-foreground">{selectedSite.custom_domain || `${selectedSite.slug}.rel8tion`}</p>
            </div>
          ) : null}

          <div>
            <Label>Tool</Label>
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              {AI_MEDIA_MODE_OPTIONS.map((option) => {
                const Icon = modeIcons[option.key]
                return (
                  <Button
                    key={option.key}
                    type="button"
                    variant={mode === option.key ? 'default' : 'outline'}
                    onClick={() => {
                      setMode(option.key)
                      setImageFiles([])
                      setErrorMessage('')
                    }}
                  >
                    <Icon className="mr-2 h-4 w-4" />
                    {option.label}
                  </Button>
                )
              })}
            </div>
          </div>

          {needsPropertyAddress && (
            <div>
              <Label htmlFor="ai-property-address">Property Address</Label>
              <Input
                id="ai-property-address"
                value={propertyAddress}
                onChange={(event) => setPropertyAddress(event.target.value)}
                placeholder="126 Scranton Ave, Lynbrook"
                className="mt-1.5"
              />
            </div>
          )}

          {mode === 'agent_headshot' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Headshot Look</Label>
                <select
                  value={headshotLook}
                  onChange={(event) => setHeadshotLook(event.target.value)}
                  className="mt-1.5 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  {HEADSHOT_LOOK_PRESETS.map((option) => (
                    <option key={option.key} value={option.key}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Background</Label>
                <select
                  value={headshotBackground}
                  onChange={(event) => setHeadshotBackground(event.target.value)}
                  className="mt-1.5 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  {HEADSHOT_BACKGROUND_PRESETS.map((option) => (
                    <option key={option.key} value={option.key}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {mode === 'staging_image' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Style</Label>
                <select
                  value={stagingStyle}
                  onChange={(event) => setStagingStyle(event.target.value)}
                  className="mt-1.5 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  {STAGING_STYLE_PRESETS.map((option) => (
                    <option key={option.key} value={option.key}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Room</Label>
                <select
                  value={roomType}
                  onChange={(event) => setRoomType(event.target.value)}
                  className="mt-1.5 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  {STAGING_ROOM_PRESETS.map((option) => (
                    <option key={option.key} value={option.key}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {mode === 'social_video' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Post Type</Label>
                <select
                  value={videoPreset}
                  onChange={(event) => setVideoPreset(event.target.value)}
                  className="mt-1.5 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  {AUTO_REEL_POST_PRESETS.map((option) => (
                    <option key={option.key} value={option.key}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Visual Style</Label>
                <select
                  value={videoStyle}
                  onChange={(event) => setVideoStyle(event.target.value)}
                  className="mt-1.5 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  {AUTO_REEL_STYLE_PRESETS.map((option) => (
                    <option key={option.key} value={option.key}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="ai-image">{uploadLabels[mode]}</Label>
            <Input
              key={mode}
              id="ai-image"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple={mode === 'social_video'}
              onChange={handleImageSelection}
              className="mt-1.5"
            />
            {mode === 'social_video' && (
              <p className="mt-2 text-xs font-medium text-muted-foreground">
                Select up to 6 listing photos. AutoReel creates a slower 12-second vertical walkthrough with REL8TION branding.
              </p>
            )}
            {imageFiles.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {imageFiles.map((file) => (
                  <Badge key={`${file.name}-${file.size}`} variant="secondary" className="max-w-full truncate">
                    {file.name}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {statusMessage && (
            <div className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{statusMessage}</span>
            </div>
          )}
          {errorMessage && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <Button type="button" onClick={createMedia} disabled={isSubmitting} className="w-full">
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {isSubmitting ? 'Creating...' : submitLabels[mode]}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Recent AI Media</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {media.map((item) => (
            <div key={item.id} className="grid gap-4 rounded-2xl border border-white/70 bg-white/60 p-4 lg:grid-cols-[220px_1fr]">
              <div className="overflow-hidden rounded-xl border border-white/70 bg-white">
                {item.result_url && item.media_type === 'social_video' ? (
                  <video src={item.result_url} controls className={`${previewClass(item.media_type)} w-full bg-black object-cover`} />
                ) : item.result_url ? (
                  <img src={item.result_url} alt="" className={`${previewClass(item.media_type)} w-full object-cover`} />
                ) : item.source_url ? (
                  <img src={item.source_url} alt="" className={`${previewClass(item.media_type)} w-full object-cover opacity-70`} />
                ) : (
                  <div className="flex aspect-[4/5] items-center justify-center text-muted-foreground">
                    <ImageIcon className="h-8 w-8" />
                  </div>
                )}
              </div>
              <div className="min-w-0 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{mediaLabels[item.media_type] || item.media_type}</Badge>
                  <Badge className={statusClass(item.status)}>{item.status}</Badge>
                  <span className="text-xs font-semibold text-muted-foreground">{formatDate(item.created_at)}</span>
                </div>

                {item.caption && (
                  <div>
                    <Label>Post Caption</Label>
                    <Textarea value={item.caption} readOnly rows={3} className="mt-1.5" />
                  </div>
                )}

                {item.error && <p className="text-sm font-semibold text-destructive">{item.error}</p>}

                <div className="flex flex-wrap gap-2">
                  {item.media_type === 'social_video' && item.status !== 'completed' && item.status !== 'failed' && (
                    <Button type="button" variant="outline" size="sm" onClick={() => checkStatus(item)} disabled={checkingId === item.id}>
                      {checkingId === item.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                      Check Status
                    </Button>
                  )}
                  {item.result_url && (
                    <Button type="button" variant="outline" size="sm" asChild>
                      <a href={item.result_url} target="_blank" rel="noopener noreferrer">
                        <Download className="mr-2 h-4 w-4" />
                        Open
                      </a>
                    </Button>
                  )}
                  {item.caption && (
                    <Button type="button" variant="secondary" size="sm" onClick={() => copyCaption(item.caption || '')}>
                      Copy Caption
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}

          {!media.length && (
            <div className="py-12 text-center text-muted-foreground">
              <ImageIcon className="mx-auto mb-3 h-10 w-10" />
              <p className="font-semibold">No AI media yet.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
