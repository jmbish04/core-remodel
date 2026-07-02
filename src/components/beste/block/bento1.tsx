"use client";

import { Badge7 } from "src/frontend/components/beste/component/badge7";
import { Button12 } from "src/frontend/components/beste/component/button12";
import Image from "next/image";
import { Quote } from "lucide-react";
import { cn } from "src/frontend/lib/utils";

interface Badge {
  label: string;
}

interface ActionButton {
  label: string;
  href: string;
}

interface StatementCard {
  index: string;
  title: string;
  body: string;
}

interface StatCard {
  value: string;
  label: string;
  caption: string;
}

interface ImageCard {
  src: string;
  alt: string;
  caption: string;
}

interface QuoteCard {
  quote: string;
  author: string;
  role: string;
}

interface Bento1Labels {
  ctaTitle: string;
  ctaNote: string;
}

interface Bento1Props {
  badge?: Badge;
  heading?: string;
  description?: string;
  statement?: StatementCard;
  stat?: StatCard;
  image?: ImageCard;
  quote?: QuoteCard;
  button?: ActionButton;
  labels?: Bento1Labels;
  className?: string;
}

export const bento1Demo: Bento1Props = {
  badge: { label: "At a glance" },
  heading: "The studio, in one grid.",
  description:
    "Six slots, one studio. A snapshot of how Auralis works — the belief we build on, the numbers, the rooms we make things in, and what people say once it ships.",
  statement: {
    index: "S/01",
    title: "We make monochrome feel loud.",
    body: "No trends to chase, no noise to add. Auralis builds brands out of type, contrast, and restraint — systems that read at a glance and still hold up a decade later.",
  },
  stat: {
    value: "138",
    label: "Launches shipped",
    caption: "Since the studio opened in 2014",
  },
  image: {
    src: "https://images.unsplash.com/photo-1698899114761-3a154520c816?q=80&w=2070&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
    alt: "Studio table layered with printed type specimens and proofs",
    caption: "Inside the type room",
  },
  quote: {
    quote:
      "They kept cutting until only the idea was left standing — then made that idea unforgettable.",
    author: "Mara Vance",
    role: "Founder, Halden Press",
  },
  button: {
    label: "Tour the studio",
    href: "https://beste.co",
  },
  labels: {
    ctaTitle: "Want the long version?",
    ctaNote: "A 30-minute walkthrough of the whole practice.",
  },
};

export function Bento1({
  badge,
  heading,
  description,
  statement,
  stat,
  image,
  quote,
  button,
  labels,
  className,
}: Bento1Props) {
  return (
    <section className={cn("py-16 md:py-24 w-full", className)}>
      <div className="mx-auto max-w-7xl px-4 md:px-6">
        <div className="flex max-w-3xl flex-col">
          {badge && <Badge7 label={badge.label} />}
          {heading && (
            <h2 className="mt-6 text-balance text-3xl font-bold leading-tight tracking-tight text-foreground md:text-4xl lg:text-5xl">
              {heading}
            </h2>
          )}
          {description && (
            <p className="mt-5 text-lg text-muted-foreground md:text-xl">{description}</p>
          )}
        </div>

        <div className="mt-12 grid grid-cols-1 gap-4 md:mt-16 md:grid-cols-6 md:grid-rows-[minmax(220px,auto)_minmax(220px,auto)_minmax(180px,auto)]">
          {/* Statement — big anchor card */}
          {statement && (
            <article className="group/bento1 flex flex-col justify-between rounded-md bg-muted p-8 md:col-span-4 md:row-span-2 md:p-10">
              <span className="text-lg font-semibold text-muted-foreground">{statement.index}</span>
              <div className="mt-10">
                <h3 className="text-balance text-3xl font-bold leading-tight tracking-tight text-foreground md:text-4xl lg:text-5xl">
                  {statement.title}
                </h3>
                <p className="mt-6 max-w-xl text-lg text-muted-foreground md:text-xl">
                  {statement.body}
                </p>
              </div>
            </article>
          )}

          {/* Stat — inverted figure card */}
          {stat && (
            <article className="flex flex-col justify-between rounded-md bg-foreground p-8 text-background md:col-span-2">
              <p className="text-base text-background/60">{stat.label}</p>
              <div className="mt-8">
                <p className="text-6xl font-bold tracking-tight md:text-7xl">{stat.value}</p>
                <p className="mt-3 text-base text-background/70">{stat.caption}</p>
              </div>
            </article>
          )}

          {/* Image — framed composition */}
          {image && (
            <article className="group/bento1 relative overflow-hidden rounded-md bg-muted md:col-span-2">
              <Image
                src={image.src}
                alt={image.alt}
                fill
                className="object-cover transition-transform duration-500"
                sizes="(max-width: 768px) 100vw, 380px"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-foreground/70 to-transparent" />
              <span className="absolute bottom-6 left-6 text-base text-background">
                {image.caption}
              </span>
            </article>
          )}

          {/* Quote — editorial pull-quote */}
          {quote && (
            <article className="flex flex-col justify-between rounded-md bg-muted p-8 md:col-span-3 md:p-10">
              <Quote className="size-7 text-muted-foreground" aria-hidden="true" />
              <blockquote className="mt-6">
                <p className="text-balance text-xl font-semibold leading-snug text-foreground md:text-2xl">
                  {quote.quote}
                </p>
                <footer className="mt-6 text-base font-semibold text-foreground">
                  {quote.author} — {quote.role}
                </footer>
              </blockquote>
            </article>
          )}

          {/* CTA — closing card */}
          <article className="flex flex-col justify-between gap-8 rounded-md bg-muted p-8 md:col-span-3 md:p-10">
            <div>
              {labels && (
                <h3 className="text-xl font-semibold text-foreground md:text-2xl">
                  {labels.ctaTitle}
                </h3>
              )}
              {labels && (
                <p className="mt-3 text-base text-muted-foreground md:text-lg">{labels.ctaNote}</p>
              )}
            </div>
            {button && <Button12 label={button.label} href={button.href} className="w-fit" />}
          </article>
        </div>
      </div>
    </section>
  );
}
