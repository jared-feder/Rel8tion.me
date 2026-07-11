import { Camera } from 'lucide-react'
import { Agent } from '@/lib/types'

interface PhotoGalleryProps {
  agent: Agent
}

function uniqueImages(images: string[]) {
  return Array.from(new Set(images.map((image) => image.trim()).filter(Boolean))).slice(0, 8)
}

export function PhotoGallery({ agent }: PhotoGalleryProps) {
  const images = uniqueImages(agent.galleryImages || [])

  if (!images.length) return null

  return (
    <section id="photos" className="bg-background py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-10 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-3 flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-accent">
              <Camera className="h-4 w-4" />
              Local Style
            </p>
            <h2 className="text-3xl font-bold text-foreground lg:text-4xl">Featured Photos</h2>
          </div>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-right">
            A closer look at the homes, neighborhoods, and client experience this site highlights.
          </p>
        </div>

        <div className="grid auto-rows-[180px] gap-4 md:grid-cols-4 md:auto-rows-[210px]">
          {images.map((image, index) => (
            <figure
              key={image}
              className={[
                'overflow-hidden rounded-2xl bg-card shadow-sm',
                index === 0 ? 'md:col-span-2 md:row-span-2' : '',
                index === 3 ? 'md:col-span-2' : '',
              ].filter(Boolean).join(' ')}
            >
              <img
                src={image}
                alt=""
                className="h-full w-full object-cover transition duration-500 hover:scale-[1.03]"
                loading="lazy"
              />
            </figure>
          ))}
        </div>
      </div>
    </section>
  )
}
