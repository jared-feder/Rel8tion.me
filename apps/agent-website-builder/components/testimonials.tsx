import { Star, Quote } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Testimonial } from '@/lib/types'

interface TestimonialsProps {
  testimonials: Testimonial[]
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`h-4 w-4 ${
            i < rating
              ? 'text-amber-500 fill-amber-500'
              : 'text-muted-foreground/30'
          }`}
        />
      ))}
    </div>
  )
}

export function Testimonials({ testimonials }: TestimonialsProps) {
  // Don't render if no testimonials
  if (!testimonials || testimonials.length === 0) {
    return null
  }

  return (
    <section id="testimonials" className="py-20 lg:py-32 bg-secondary/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <p className="text-accent font-medium tracking-wide uppercase text-sm mb-4">
            Client Stories
          </p>
          <h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-4">
            What My Clients Say
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Building lasting relationships through exceptional service. Here is what
            some of my clients have to say about their experience.
          </p>
        </div>

        {/* Testimonials Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {testimonials.map((testimonial) => (
            <Card
              key={testimonial.id}
              className="bg-card border-border hover:shadow-lg transition-shadow"
            >
              <CardContent className="p-6">
                {/* Quote Icon */}
                <div className="mb-4">
                  <div className="p-2 bg-accent/10 rounded-lg w-fit">
                    <Quote className="h-5 w-5 text-accent" />
                  </div>
                </div>

                {/* Rating */}
                <div className="mb-4">
                  <StarRating rating={testimonial.rating} />
                </div>

                {/* Text */}
                <p className="text-muted-foreground leading-relaxed mb-6">
                  &ldquo;{testimonial.text}&rdquo;
                </p>

                {/* Client Info */}
                <div className="flex items-center justify-between pt-4 border-t border-border">
                  <div>
                    <p className="font-semibold text-foreground">
                      {testimonial.clientName}
                    </p>
                    {testimonial.propertyType && (
                      <p className="text-sm text-muted-foreground">
                        {testimonial.propertyType}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(testimonial.date).toLocaleDateString('en-US', {
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}
