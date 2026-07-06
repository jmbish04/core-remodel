npm install motion
npm install lucide-react

Create a lib/utils.ts file to manage Tailwind CSS classes:

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
return twMerge(clsx(inputs));
}

npx shadcn@latest add @uitripled/cards-slider-shadcnui

"use client";

import {
Avatar,
AvatarFallback,
AvatarImage,
} from "@uitripled/react-shadcn/ui/avatar";
import { Badge } from "@uitripled/react-shadcn/ui/badge";
import { Card } from "@uitripled/react-shadcn/ui/card";
import { animate, motion, useMotionValue } from "framer-motion";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface CardData {
id: number;
title: string;
description: string;
category: string;
image: string;
author: {
name: string;
avatar: string;
};
date: string;
readTime: string;
}

const cards: CardData[] = [
{
id: 1,
title: "Liquid Motion",
description:
"Experience the fluid dynamics of modern web interactions with physics-based animations.",
category: "Animation",
image:
"https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&q=80",
author: { name: "Alex Rivera", avatar: "https://github.com/shadcn.png" },
date: "Dec 12, 2024",
readTime: "5 min read",
},
{
id: 2,
title: "Glassmorphism",
description:
"Blur the lines between layers with advanced backdrop filters and transparency effects.",
category: "Design",
image:
"https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?w=800&q=80",
author: { name: "Sarah Chen", avatar: "https://github.com/shadcn.png" },
date: "Dec 10, 2024",
readTime: "4 min read",
},
{
id: 3,
title: "Dark Mode",
description:
"Easy on the eyes, elegant in appearance. A seamless transition to the dark side.",
category: "Theme",
image:
"https://images.unsplash.com/photo-1618005198919-d3d4b5a92ead?w=800&q=80",
author: { name: "Mike Johnson", avatar: "https://github.com/shadcn.png" },
date: "Dec 8, 2024",
readTime: "6 min read",
},
{
id: 4,
title: "Micro-Interactions",
description:
"Delightful details that make the difference between good and great user experience.",
category: "UX",
image:
"https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?w=800&q=80",
author: { name: "Emily Davis", avatar: "https://github.com/shadcn.png" },
date: "Dec 5, 2024",
readTime: "3 min read",
},
{
id: 5,
title: "Responsive Layouts",
description:
"Fluid grids that adapt to any screen size, ensuring your content looks perfect everywhere.",
category: "Layout",
image:
"https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&q=80",
author: { name: "David Kim", avatar: "https://github.com/shadcn.png" },
date: "Dec 3, 2024",
readTime: "7 min read",
},
];

export function CardsSlider() {
const containerRef = useRef<HTMLDivElement>(null);
const [width, setWidth] = useState(0);
const x = useMotionValue(0);
const [currentIndex, setCurrentIndex] = useState(0);

useEffect(() => {
if (containerRef.current) {
setWidth(
containerRef.current.scrollWidth - containerRef.current.offsetWidth
);
}
}, []);

const CARD_WIDTH = 350; // Approximate width + gap
const GAP = 24;

const scrollTo = (direction: "left" | "right") => {
const currentX = x.get();
const containerWidth = containerRef.current?.offsetWidth || 0;
const scrollAmount = containerWidth \* 0.8; // Scroll 80% of container width

    let newX =
      direction === "left" ? currentX + scrollAmount : currentX - scrollAmount;

    // Clamp values
    newX = Math.max(Math.min(newX, 0), -width);

    animate(x, newX, {
      type: "spring",
      stiffness: 300,
      damping: 30,
      mass: 1,
    });

};

return (
<div className="w-full max-w-6xl mx-auto p-8 relative group/slider">
{/_ Navigation Arrows _/}
<div className="absolute top-1/2 -translate-y-1/2 left-2 z-20 opacity-0 group-hover/slider:opacity-100 transition-opacity duration-300">
<button
onClick={() => scrollTo("left")}
className="h-12 w-12 rounded-full bg-background/80 backdrop-blur-md border border-border/50 shadow-lg flex items-center justify-center hover:bg-background hover:scale-110 transition-all active:scale-95"
aria-label="Scroll left" >
<ChevronLeft className="w-6 h-6" />
</button>
</div>
<div className="absolute top-1/2 -translate-y-1/2 right-2 z-20 opacity-0 group-hover/slider:opacity-100 transition-opacity duration-300">
<button
onClick={() => scrollTo("right")}
className="h-12 w-12 rounded-full bg-background/80 backdrop-blur-md border border-border/50 shadow-lg flex items-center justify-center hover:bg-background hover:scale-110 transition-all active:scale-95"
aria-label="Scroll right" >
<ChevronRight className="w-6 h-6" />
</button>
</div>

      <motion.div
        ref={containerRef}
        className="cursor-grab active:cursor-grabbing overflow-hidden px-4 py-8 -mx-4 -my-8"
        whileTap={{ cursor: "grabbing" }}
      >
        <motion.div
          drag="x"
          dragConstraints={{ right: 0, left: -width }}
          dragElastic={0.1}
          style={{ x }}
          className="flex gap-6"
        >
          {cards.map((card) => (
            <motion.div
              key={card.id}
              className="min-w-[320px] max-w-[320px] h-[420px]"
              whileHover={{ y: -10, transition: { duration: 0.3 } }}
            >
              <Card className="group relative h-full overflow-hidden rounded-3xl border-border/50 bg-card/30 backdrop-blur-md transition-all duration-500 hover:border-primary/50 hover:shadow-2xl hover:shadow-primary/10">
                {/* Image Section */}
                <div className="relative h-48 overflow-hidden">
                  <motion.img
                    src={card.image}
                    alt={card.title}
                    className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent opacity-60 transition-opacity duration-300 group-hover:opacity-40" />

                  <div className="absolute top-4 left-4">
                    <Badge
                      variant="secondary"
                      className="bg-background/50 backdrop-blur-md border-white/10 text-xs font-medium px-3 py-1"
                    >
                      {card.category}
                    </Badge>
                  </div>

                  {/* Hover Overlay Action */}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-[2px] opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className="flex items-center gap-2 rounded-full bg-white/90 px-5 py-2 text-sm font-semibold text-black shadow-lg"
                    >
                      View Details
                    </motion.button>
                  </div>
                </div>

                {/* Content Section */}
                <div className="p-6 flex flex-col h-[calc(100%-12rem)] justify-between">
                  <div className="space-y-3">
                    <h3 className="text-xl font-bold leading-tight tracking-tight text-foreground transition-colors group-hover:text-primary">
                      {card.title}
                    </h3>
                    <p className="line-clamp-3 text-sm text-muted-foreground leading-relaxed">
                      {card.description}
                    </p>
                  </div>

                  <div className="pt-4 mt-auto border-t border-border/50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-8 w-8 border border-border/50 ring-2 ring-background">
                        <AvatarImage
                          src={card.author.avatar}
                          alt={card.author.name}
                        />
                        <AvatarFallback>{card.author.name[0]}</AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col">
                        <span className="text-xs font-semibold text-foreground">
                          {card.author.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {card.date}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-secondary/50 px-2.5 py-1 rounded-full">
                      <Clock className="h-3 w-3" />
                      <span>{card.readTime}</span>
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </motion.div>
    </div>

);
}

# Pulling things out of the "Drawer"

npx shadcn@latest add @uitripled/gallery-grid-block-shadcnui

"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Grid, X, ZoomIn } from "lucide-react";
import { KeyboardEvent, useState } from "react";

const galleryImages = [
{
id: 1,
url: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=500",
title: "Abstract Architecture",
category: "Architecture",
},
{
id: 2,
url: "https://images.unsplash.com/photo-1618556450994-a6a128ef0d9d?w=500",
title: "Modern Design",
category: "Design",
},
{
id: 3,
url: "https://images.unsplash.com/photo-1618005198919-d3d4b5a92ead?w=500",
title: "Urban Landscape",
category: "Nature",
},
{
id: 4,
url: "https://images.unsplash.com/photo-1634017839464-5c339ebe3cb4?w=500",
title: "Digital Art",
category: "Art",
},
{
id: 5,
url: "https://images.unsplash.com/photo-1618556450991-2f1af64e8191?w=500",
title: "Creative Space",
category: "Architecture",
},
{
id: 6,
url: "https://images.unsplash.com/photo-1618005198919-d3d4b5a92ead?w=500",
title: "Minimalist View",
category: "Design",
},
];

export function GalleryGridBlock() {
const [selectedImage, setSelectedImage] = useState<number | null>(null);
const [filter, setFilter] = useState<string>("All");

const categories = [
"All",
...new Set(galleryImages.map((img) => img.category)),
];

const filteredImages =
filter === "All"
? galleryImages
: galleryImages.filter((img) => img.category === filter);

const handleNext = () => {
if (selectedImage !== null) {
const currentIndex = galleryImages.findIndex(
(img) => img.id === selectedImage
);
const nextIndex = (currentIndex + 1) % galleryImages.length;
setSelectedImage(galleryImages[nextIndex].id);
}
};

const handlePrev = () => {
if (selectedImage !== null) {
const currentIndex = galleryImages.findIndex(
(img) => img.id === selectedImage
);
const prevIndex =
(currentIndex - 1 + galleryImages.length) % galleryImages.length;
setSelectedImage(galleryImages[prevIndex].id);
}
};

const selectedImageData = galleryImages.find(
(img) => img.id === selectedImage
);

const handleCardKeyDown = (
event: KeyboardEvent<HTMLDivElement>,
imageId: number
) => {
if (event.key === "Enter" || event.key === " ") {
event.preventDefault();
setSelectedImage(imageId);
}
};

return (
<section
      className="w-full bg-background px-4 py-16"
      aria-labelledby="gallery-heading"
    >
<div className="mx-auto max-w-7xl">
<motion.div
initial={{ opacity: 0, y: -20 }}
animate={{ opacity: 1, y: 0 }}
transition={{ duration: 0.6 }}
className="mb-12 text-center"
role="region"
aria-labelledby="gallery-heading" >
<Badge className="mb-4" variant="secondary">
<Grid className="mr-1 h-3 w-3" />
Gallery
</Badge>
<h2
            id="gallery-heading"
            className="mb-4 text-4xl font-bold tracking-tight"
          >
Our Portfolio
</h2>
<p className="mx-auto max-w-2xl text-muted-foreground">
Explore our collection of stunning visuals and creative work
</p>
</motion.div>

        {/* Filter Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mb-8 flex flex-wrap justify-center gap-2"
          role="group"
          aria-label="Gallery categories"
        >
          {categories.map((category) => (
            <Button
              key={category}
              variant={filter === category ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(category)}
              aria-pressed={filter === category}
            >
              {category}
            </Button>
          ))}
        </motion.div>

        {/* Gallery Grid */}
        <motion.div
          layout
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          role="list"
          aria-label="Gallery items"
        >
          <AnimatePresence mode="popLayout">
            {filteredImages.map((image, index) => (
              <motion.div
                key={image.id}
                layout
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.3, delay: index * 0.05 }}
                role="listitem"
              >
                <Card
                  className="group relative cursor-pointer overflow-hidden border-border transition-all hover:border-ring hover:shadow-xl"
                  onClick={() => setSelectedImage(image.id)}
                  onKeyDown={(event) => handleCardKeyDown(event, image.id)}
                  role="button"
                  tabIndex={0}
                  aria-label={`View details for ${image.title}`}
                >
                  <div className="relative aspect-square overflow-hidden">
                    <motion.img
                      src={image.url}
                      alt={image.title}
                      className="h-full w-full object-cover"
                      whileHover={{ scale: 1.1 }}
                      transition={{ duration: 0.3 }}
                    />

                    {/* Overlay */}
                    <motion.div
                      initial={{ opacity: 0 }}
                      whileHover={{ opacity: 1 }}
                      transition={{ duration: 0.2 }}
                      className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm"
                      aria-hidden="true"
                    >
                      <ZoomIn className="mb-2 h-8 w-8 text-[var(--muted-foreground)]" />
                      <h3 className="mb-1 text-center text-lg font-semibold text-[var(--muted-foreground)]">
                        {image.title}
                      </h3>
                      <Badge variant="secondary">{image.category}</Badge>
                    </motion.div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>

        {/* Lightbox */}
        <AnimatePresence>
          {selectedImage !== null && selectedImageData && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
              onClick={() => setSelectedImage(null)}
              role="dialog"
              aria-modal="true"
              aria-labelledby="gallery-dialog-title"
              aria-describedby="gallery-dialog-description"
            >
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                onClick={(e) => e.stopPropagation()}
                className="relative max-h-[90vh] max-w-5xl"
              >
                {/* Close Button */}
                <Button
                  size="icon"
                  variant="ghost"
                  className="absolute -right-12 top-0 text-[var(--muted-foreground)] hover:bg-white/10"
                  onClick={() => setSelectedImage(null)}
                  aria-label="Close gallery dialog"
                >
                  <X className="h-6 w-6" />
                </Button>

                {/* Navigation Buttons */}
                <Button
                  size="icon"
                  variant="ghost"
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:bg-white/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePrev();
                  }}
                  aria-label="View previous image"
                >
                  <ChevronLeft className="h-8 w-8" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:bg-white/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleNext();
                  }}
                  aria-label="View next image"
                >
                  <ChevronRight className="h-8 w-8" />
                </Button>

                {/* Image */}
                <motion.img
                  key={selectedImage}
                  src={selectedImageData.url}
                  alt={selectedImageData.title}
                  className="max-h-[80vh] w-auto rounded-lg"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2 }}
                />

                {/* Image Info */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="mt-4 text-center text-[var(--muted-foreground)]"
                  id="gallery-dialog-description"
                >
                  <h3
                    className="mb-2 text-xl font-semibold"
                    id="gallery-dialog-title"
                  >
                    {selectedImageData.title}
                  </h3>
                  <Badge variant="secondary">
                    {selectedImageData.category}
                  </Badge>
                </motion.div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>

);
}

# Providing user with inventory of 'things' (aka, inventory of tools, etc)

npx shadcn@latest add @uitripled/animated-list-shadcnui

"use client";

import { Card } from "@/components/ui/card";
import { motion, type Variants } from "framer-motion";
import { CheckCircle2 } from "lucide-react";

const checklistItems = [
"Define the experience",
"Design high-fidelity flows",
"Develop interactive states",
"Test accessibility scenarios",
"Deploy with confidence",
];

const containerVariants: Variants = {
hidden: { opacity: 0 },
visible: {
opacity: 1,
transition: {
staggerChildren: 0.12,
delayChildren: 0.2,
},
},
};

const listItemVariants: Variants = {
hidden: { opacity: 0, x: -20 },
visible: {
opacity: 1,
x: 0,
transition: { duration: 0.4, ease: "easeOut" },
},
};

const iconVariants: Variants = {
hidden: { scale: 0 },
visible: {
scale: 1,
transition: { type: "spring", stiffness: 200, damping: 16, delay: 0.1 },
},
};

export function AnimatedList() {
return (
<div className="">
<Card
        role="article"
        aria-label="Workflow checklist"
        className="group relative w-full overflow-hidden rounded-2xl border border-border/40 bg-background/60 p-6 backdrop-blur transition-all hover:border-border/60 hover:shadow-lg"
      >
<div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-foreground/[0.04] via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 -z-10" />

        <motion.div
          className="relative space-y-6"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-foreground/70">
              Workflow
            </p>
            <h3 className="text-lg font-semibold tracking-tight text-foreground">
              Project Checklist
            </h3>
            <p className="text-sm text-foreground/70">
              Guide your team through each phase with confidence and clarity.
            </p>
          </div>

          <motion.ul
            role="list"
            aria-label="Project workflow steps"
            className="space-y-3"
            variants={containerVariants}
          >
            {checklistItems.map((item) => (
              <motion.li
                key={item}
                variants={listItemVariants}
                className="group/list flex items-center gap-3 rounded-xl border border-border/30 bg-background/40 p-3 transition-all duration-300 hover:border-border/50 hover:bg-background/60"
              >
                <motion.span
                  variants={iconVariants}
                  aria-hidden="true"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-600 transition-colors dark:text-emerald-400"
                >
                  <CheckCircle2 className="h-4 w-4" />
                </motion.span>

                <span className="text-sm text-foreground">{item}</span>
              </motion.li>
            ))}
          </motion.ul>
        </motion.div>
      </Card>
    </div>

);
}

# Anytime that the user is awaiting an action from gemini photo edits (as opposed to just making the user sit and wait)

pnpm dlx shadcn@latest add "https://eldoraui.site/r/photon-beam"

<div className="relative h-[500px] w-full overflow-hidden rounded-lg border">
  <PhotonBeam
    colorBg="#080808"
    colorLine="#005f6f"
    colorSignal="#00d9ff"
    colorSignal2="#00ffff"
    colorSignal3="#00b8d4"
    lineCount={80}
    spreadHeight={30.33}
    signalCount={94}
    speedGlobal={0.345}
    trailLength={3}
    bloomStrength={3.0}
    bloomRadius={0.5}
  />
</div>

Props
Prop Type Default Description
colorBg string "#080808" Background color (hex)
colorLine string "#005f6f" Base line color (hex)
colorSignal string "#00d9ff" Primary signal/trail color (hex)
useColor2 boolean false Enable second signal color
colorSignal2 string "#00ffff" Second signal color when useColor2 is true
useColor3 boolean false Enable third signal color
colorSignal3 string "#00b8d4" Third signal color when useColor3 is true
lineCount number 80 Number of beam lines
spreadHeight number 30.33 Vertical spread of the beam field
spreadDepth number 0 Depth spread of the beam field
curveLength number 50 Length of curved segments
straightLength number 100 Length of straight segments
curvePower number 0.8265 Curve shape exponent
waveSpeed number 2.48 Speed of wave motion
waveHeight number 0.145 Amplitude of wave motion
lineOpacity number 0.557 Opacity of beam lines (0–1)
signalCount number 94 Number of moving signal particles
speedGlobal number 0.345 Global animation speed multiplier
trailLength number 3 Length of signal trails
bloomStrength number 3.0 Bloom post-processing intensity
bloomRadius number 0.5 Bloom effect radius

# Another looking inside the "drawer"

npx shadcn@latest add "https://motion-primitives.com/c/animated-group.json"

import { AnimatedGroup } from '@/components/core/animated-group';

export function AnimatedGroupPreset() {
return (
<AnimatedGroup
      className='grid grid-cols-2 gap-4 p-8 md:grid-cols-3 lg:grid-cols-4'
      preset='scale'
    >
<img
        src='https://images.beta.cosmos.so/fc6fdd93-552c-47e6-98aa-b8fb3ba070a2?format=jpeg'
        alt='impressionist painting, uploaded to Cosmos'
        className='h-auto w-full rounded-[4px]'
      />
<img
        src='https://images.beta.cosmos.so/cb674d14-ebd1-4408-bab1-79df895017b6?format=jpeg'
        alt='impressionist painting, uploaded to Cosmos'
        className='h-auto w-full rounded-[4px]'
      />
<img
        src='https://images.beta.cosmos.so/e5a6c3ed-82ad-4084-9a11-1eccd7bc91aa?format=jpeg'
        alt='impressionist painting, uploaded to Cosmos'
        className='h-auto w-full rounded-[4px]'
      />
<img
        src='https://images.beta.cosmos.so/4d02a1e7-d1f2-4575-86a9-bed243e59132?format=jpeg'
        alt='impressionist painting, uploaded to Cosmos'
        className='h-auto w-full rounded-[4px]'
      />
</AnimatedGroup>
);
}

# bento

npx shadcn@latest add "https://motion-primitives.com/c/in-view.json"

'use client';
import { InView } from '@/components/core/in-view';
import { motion } from 'motion/react';

export function InViewImagesGrid() {
return (
<div className='h-full w-full overflow-auto'>
<div className='mb-20 py-12 text-center text-sm'>Scroll down</div>
<div className='flex h-[1200px] items-end justify-center pb-12'>
<InView
viewOptions={{ once: true, margin: '0px 0px -250px 0px' }}
variants={{
            hidden: {
              opacity: 0,
            },
            visible: {
              opacity: 1,
              transition: {
                staggerChildren: 0.09,
              },
            },
          }} >
<div className='columns-2 gap-4 px-8 sm:columns-3'>
{[
'https://images.beta.cosmos.so/e5ebb6f8-8202-40ec-bc70-976f81153501?format=jpeg',
'https://images.beta.cosmos.so/1b6f1bee-1b4c-4035-9e93-c93ef4d445e1?format=jpeg',
'https://images.beta.cosmos.so/9968a6cf-d7f6-4ec9-a56d-ac4eef3f8689?format=jpeg',
'https://images.beta.cosmos.so/4b88a39c-c657-4911-b843-b473237e83b5?format=jpeg',
'https://images.beta.cosmos.so/86af92c0-064d-4801-b7ed-232535b03328?format=jpeg',
'https://images.beta.cosmos.so/399e2a4a-e118-4aaf-9c7e-155ed18f6556?format=jpeg',
'https://images.beta.cosmos.so/6ff16bc9-dc94-4549-a057-673a603ce203?format=jpeg',
'https://images.beta.cosmos.so/d67c3185-4480-4408-8f9d-1cbf541e5d91?format=jpeg',
'https://images.beta.cosmos.so/a7b19274-3370-4080-b734-e8ac268d8c8e.?format=jpeg',
'https://images.beta.cosmos.so/551daf0d-77e8-472c-9324-468fed15a0ba?format=jpeg',
].map((imgSrc, index) => {
return (
<motion.div
variants={{
                    hidden: { opacity: 0, scale: 0.8, filter: 'blur(10px)' },
                    visible: {
                      opacity: 1,
                      scale: 1,
                      filter: 'blur(0px)',
                    },
                  }}
key={index}
className='mb-4' >
<img
src={imgSrc}
alt={`Image placeholder from cosmos.so, index:${index}`}
className='size-full rounded-lg object-contain'
/>
</motion.div>
);
})}
</div>
</InView>
</div>
</div>
);
}

# Just cool looking

npx motion-primitives@latest add border-trail

'use client';
import { cn } from '@/lib/utils';
import { BorderTrail } from '@/components/core/border-trail';
import { useState } from 'react';

export function BorderTrailCard2() {
const [isLoading, setIsLoading] = useState(false);
const [isVisible, setIsVisible] = useState(true);

const handleAnimationComplete = () => {
setIsLoading(false);
setTimeout(() => setIsVisible(false), 300);
};

const handleLoad = () => {
setIsLoading(true);
setIsVisible(true);
};

return (
<div className='relative h-[200px] w-[300px] rounded-md border border-zinc-300/40 bg-zinc-100 px-4 py-3 dark:border-zinc-700/40 dark:bg-zinc-900'>
{isVisible && (
<BorderTrail
className={cn(
'bg-linear-to-l from-green-300 via-green-500 to-green-300 transition-opacity duration-300 dark:from-green-700/30 dark:via-green-500 dark:to-green-700/30',
isLoading ? 'opacity-100' : 'opacity-0'
)}
size={120}
transition={{
            ease: [0, 0.5, 0.8, 0.5],
            duration: 4,
            repeat: 2,
          }}
onAnimationComplete={handleAnimationComplete}
/>
)}
<div className='flex h-full flex-col items-end justify-end'>
<button
          className='relative ml-1 flex h-8 scale-100 select-none appearance-none items-center justify-center rounded-lg border border-zinc-950/10 bg-white px-2 text-sm text-zinc-500 focus-visible:ring-2 active:scale-[0.96] dark:border-zinc-50/10'
          type='button'
          aria-label='Load'
          onClick={handleLoad}
        >
Submit
</button>
</div>
</div>
);
}

# Other cool components to elevate the design experience

# Particle Typography

Renders dynamic typography constructed entirely from particles that elegantly disperse and reassemble upon cursor interaction using spring physics.

## Installation

```bash
npx componentry@latest add cursor-driven-particle-typography
```

## Source Code

```tsx
"use client";

import { cn } from "@workspace/ui/lib/utils";
import React, { useEffect, useRef } from "react";

export interface CursorDrivenParticleTypographyProps {
  /** Additional CSS classes */
  className?: string;
  /** The text to render */
  text: string;
  /** Font size in pixels */
  fontSize?: number;
  /** Font family */
  fontFamily?: string;
  /** Size of each particle */
  particleSize?: number;
  /** Density of particles (lower number = more particles, minimum 1) */
  particleDensity?: number;
  /** How strongly the cursor pushes particles away */
  dispersionStrength?: number;
  /** Speed at which particles return to origin */
  returnSpeed?: number;
  /** Custom color for particles. Overrides inherited text color if set. */
  color?: string;
}

class Particle {
  x: number;
  y: number;
  originX: number;
  originY: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  dispersion: number;
  returnSpd: number;

  constructor(
    x: number,
    y: number,
    size: number,
    color: string,
    dispersion: number,
    returnSpd: number,
  ) {
    this.x = x + (Math.random() - 0.5) * 10; // start with slight randomness
    this.y = y + (Math.random() - 0.5) * 10;
    this.originX = x;
    this.originY = y;
    this.vx = (Math.random() - 0.5) * 5;
    this.vy = (Math.random() - 0.5) * 5;
    this.size = size;
    this.color = color;
    this.dispersion = dispersion;
    this.returnSpd = returnSpd;
  }

  update(mouseX: number, mouseY: number) {
    const dx = mouseX - this.x;
    const dy = mouseY - this.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Physics interaction with mouse
    const interactionRadius = 120; // 120px interaction radius

    if (distance < interactionRadius && mouseX !== -1000 && mouseY !== -1000) {
      const forceDirectionX = dx / distance;
      const forceDirectionY = dy / distance;

      const force = (interactionRadius - distance) / interactionRadius;

      // Calculate repulsion
      const repulsionX = forceDirectionX * force * this.dispersion;
      const repulsionY = forceDirectionY * force * this.dispersion;

      this.vx -= repulsionX;
      this.vy -= repulsionY;
    }

    // Return to origin (spring physics)
    this.vx += (this.originX - this.x) * this.returnSpd;
    this.vy += (this.originY - this.y) * this.returnSpd;

    // Friction
    this.vx *= 0.85;
    this.vy *= 0.85;

    // Add subtle noise/jitter when close to origin
    const distToOrigin = Math.sqrt(
      Math.pow(this.x - this.originX, 2) + Math.pow(this.y - this.originY, 2),
    );
    if (distToOrigin < 1 && Math.random() > 0.95) {
      this.vx += (Math.random() - 0.5) * 0.2;
      this.vy += (Math.random() - 0.5) * 0.2;
    }

    this.x += this.vx;
    this.y += this.vy;
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function CursorDrivenParticleTypography({
  className,
  text,
  fontSize = 120,
  fontFamily = "Inter, sans-serif",
  particleSize = 1.5,
  particleDensity = 6,
  dispersionStrength = 15,
  returnSpeed = 0.08,
  color,
}: CursorDrivenParticleTypographyProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    let animationFrameId: number;
    let particles: Particle[] = [];

    let mouseX = -1000;
    let mouseY = -1000;

    let containerWidth = 0;
    let containerHeight = 0;

    const init = () => {
      const container = containerRef.current;
      if (!container) return;

      containerWidth = container.clientWidth;
      containerHeight = container.clientHeight;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = containerWidth * dpr;
      canvas.height = containerHeight * dpr;
      canvas.style.width = `${containerWidth}px`;
      canvas.style.height = `${containerHeight}px`;

      ctx.scale(dpr, dpr);

      // Determine text color
      const computedStyle = window.getComputedStyle(container);
      const textColor = color || computedStyle.color || "#000000";

      ctx.clearRect(0, 0, containerWidth, containerHeight);

      // Draw text to generate pixel map
      ctx.fillStyle = textColor;
      // Responsive font size based on container width if text is large
      const effectiveFontSize = Math.min(fontSize, containerWidth * 0.15);
      ctx.font = `bold ${effectiveFontSize}px ${fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Draw standard text first to measure it
      ctx.fillText(text, containerWidth / 2, containerHeight / 2);

      // Get pixel data
      const textCoordinates = ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      );
      particles = [];

      // Create particles from text pixels
      // Step by density multiplied by dpr
      const step = Math.max(1, Math.floor(particleDensity * dpr));
      for (let y = 0; y < textCoordinates.height; y += step) {
        for (let x = 0; x < textCoordinates.width; x += step) {
          const index = (y * textCoordinates.width + x) * 4;
          const alpha = textCoordinates.data[index + 3] || 0;

          if (alpha > 128) {
            particles.push(
              new Particle(
                x / dpr,
                y / dpr,
                particleSize,
                textColor,
                dispersionStrength,
                returnSpeed,
              ),
            );
          }
        }
      }
    };

    const animate = () => {
      ctx.clearRect(0, 0, containerWidth, containerHeight);

      particles.forEach((particle) => {
        particle.update(mouseX, mouseY);
        particle.draw(ctx);
      });
      animationFrameId = requestAnimationFrame(animate);
    };

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseX = e.clientX - rect.left;
      mouseY = e.clientY - rect.top;
    };

    const handleMouseLeave = () => {
      mouseX = -1000;
      mouseY = -1000;
    };

    const handleResize = () => {
      init();
    };

    // Initialize with a short delay to ensure fonts/layout are ready
    const timeoutId = setTimeout(() => {
      init();
      animate();
    }, 100);

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    // Re-initialize particles when the theme changes (detects class changes on html tag)
    const themeObserver = new MutationObserver(() => {
      init();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseleave", handleMouseLeave);
    canvas.addEventListener("touchstart", (e) => {
      if (!e.touches[0]) return;
      const rect = canvas.getBoundingClientRect();
      mouseX = e.touches[0].clientX - rect.left;
      mouseY = e.touches[0].clientY - rect.top;
    });
    canvas.addEventListener("touchmove", (e) => {
      if (!e.touches[0]) return;
      const rect = canvas.getBoundingClientRect();
      mouseX = e.touches[0].clientX - rect.left;
      mouseY = e.touches[0].clientY - rect.top;
    });
    canvas.addEventListener("touchend", handleMouseLeave);

    return () => {
      clearTimeout(timeoutId);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
      cancelAnimationFrame(animationFrameId);
    };
  }, [
    text,
    fontSize,
    fontFamily,
    particleSize,
    particleDensity,
    dispersionStrength,
    returnSpeed,
    color,
  ]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "w-full h-full min-h-[400px] flex items-center justify-center relative touch-none",
        className,
      )}
    >
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
}
```

## Usage

```tsx
import { CursorDrivenParticleTypography } from "@/components/ui/cursor-driven-particle-typography";

export default function ParticleTypographyDefault() {
  return (
    <div className="w-full min-h-[400px] relative">
      <CursorDrivenParticleTypography text="Design" />
    </div>
  );
}
```

## API Reference (Props)

| Prop                 | Type     | Default               | Description                                                                                                                                |
| -------------------- | -------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `text`               | `string` | -                     | The text content to render with particles.                                                                                                 |
| `fontSize`           | `number` | `120`                 | Base font size in pixels. Scales down automatically for smaller containers.                                                                |
| `fontFamily`         | `string` | `"Inter, sans-serif"` | Font family for the text.                                                                                                                  |
| `particleSize`       | `number` | `1.5`                 | Radius of each particle in pixels.                                                                                                         |
| `particleDensity`    | `number` | `6`                   | Spacing between original pixel sampling. Lower number = more particles (higher density). Warning: very low numbers may impact performance. |
| `dispersionStrength` | `number` | `15`                  | How strongly the cursor pushes particles away on hover.                                                                                    |
| `returnSpeed`        | `number` | `0.08`                | Strength of the spring physics pulling particles back to their origin.                                                                     |
| `color`              | `string` | -                     | Custom color for the particles. If omitted, it inherits parent text color.                                                                 |
| `className`          | `string` | -                     | Additional CSS classes for custom styling of the wrapper div.                                                                              |

### Custom Particle Color

```tsx
import { CursorDrivenParticleTypography } from "@/components/ui/cursor-driven-particle-typography";

export default function ParticleTypographyBlue() {
  return (
    <div className="w-full min-h-[400px] relative">
      <CursorDrivenParticleTypography
        text="Create"
        color="#2563eb"
        particleSize={2}
        dispersionStrength={20}
      />
    </div>
  );
}
```

### Fine Particles (High Density)

```tsx
import { CursorDrivenParticleTypography } from "@/components/ui/cursor-driven-particle-typography";

export default function ParticleTypographyDense() {
  return (
    <div className="w-full min-h-[400px] relative">
      <CursorDrivenParticleTypography
        text="Details"
        particleDensity={2}
        particleSize={1}
        fontSize={120}
      />
    </div>
  );
}
```

---

_Component from [Componentry](https://componentry.dev/docs/components/cursor-driven-particle-typography)_

# Another great way to look through inspiration photos to pick them out of the "drawer"

# Sticky Scroll Cards

A scroll-driven card stack where images pin in place and scale down as you scroll, creating a satisfying layered depth effect.

## Installation

```bash
npx componentry@latest add sticky-scroll-cards
```

**Dependencies:** framer-motion lenis

## Source Code

```tsx
"use client";

import { cn } from "@/lib/utils";
import { motion, useScroll, useTransform } from "framer-motion";
import ReactLenis from "lenis/react";
import { useEffect, useRef } from "react";

export interface StickyScrollCardItem {
  title: string;
  src: string;
}

const DEFAULT_CARDS: StickyScrollCardItem[] = [
  {
    title: "Misty Alps",
    src: "https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=1200&q=85",
  },
  {
    title: "Sunlit Grove",
    src: "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1200&q=85",
  },
  {
    title: "Turquoise Shore",
    src: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&q=85",
  },
  {
    title: "Mountain Pass",
    src: "https://images.unsplash.com/photo-1482938289607-e9573fc25ebb?w=1200&q=85",
  },
  {
    title: "Rolling Hills",
    src: "https://images.unsplash.com/photo-1501854140801-50d01698950b?w=1200&q=85",
  },
];

// Very subtle tilts — natural scatter without looking messy
const CARD_ROTATIONS = [-1.4, 1.0, -0.8, 1.6, -1.1];

interface StickyScrollCardProps {
  i: number;
  title: string;
  src: string;
  progress: ReturnType<typeof useScroll>["scrollYProgress"];
  range: [number, number];
  targetScale: number;
}

function StickyScrollCard({
  i,
  title,
  src,
  progress,
  range,
  targetScale,
}: StickyScrollCardProps) {
  const scale = useTransform(progress, range, [1, targetScale]);
  const rotation = CARD_ROTATIONS[i % CARD_ROTATIONS.length];

  return (
    <div className="sticky top-0 flex h-screen items-center justify-center">
      <motion.div
        style={{
          scale,
          rotate: rotation,
          top: `calc(-5vh + ${i * 22 + 160}px)`,
          borderRadius: 4,
          boxShadow:
            "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.07), 0 12px 32px rgba(0,0,0,0.10), 0 24px 56px rgba(0,0,0,0.08)",
        }}
        className="relative -top-1/4 origin-top overflow-hidden bg-white"
      >
        {/* 10px border on three sides */}
        <div className="p-[10px] pb-0">
          <div className="w-[460px] overflow-hidden">
            <img
              src={src}
              alt={title}
              className="block h-[290px] w-full object-cover"
              draggable={false}
            />
          </div>
        </div>

        {/* Caption strip — trimmed height */}
        <div className="flex h-[44px] items-center justify-center px-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-neutral-400">
            {title}
          </p>
        </div>
      </motion.div>
    </div>
  );
}

interface StickyScrollCardsProps {
  /** Array of card items, each with a title and image src URL */
  cards?: StickyScrollCardItem[];
  /** Hint label shown above the stack */
  hint?: string;
  /** Additional CSS classes for the outer container */
  className?: string;
}

export function StickyScrollCards({
  cards = DEFAULT_CARDS,
  hint = "scroll to explore",
  className,
}: StickyScrollCardsProps) {
  const container = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: container,
    offset: ["start start", "end end"],
  });

  // Hide the native scrollbar while this component is mounted
  useEffect(() => {
    const style = document.createElement("style");
    style.id = "__sticky-scroll-cards-no-bar";
    style.textContent =
      "html { scrollbar-width: none; -ms-overflow-style: none; } html::-webkit-scrollbar { display: none; }";
    document.head.appendChild(style);
    return () => {
      document.getElementById("__sticky-scroll-cards-no-bar")?.remove();
    };
  }, []);

  return (
    <ReactLenis root>
      <main
        ref={container}
        className={cn(
          "relative flex w-full flex-col items-center justify-center pb-[100vh] pt-[50vh]",
          className,
        )}
      >
        {/* Hint label */}
        <div className="absolute left-1/2 top-[8%] flex -translate-x-1/2 flex-col items-center gap-3">
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] opacity-30">
            {hint}
          </p>
          <span className="h-12 w-px bg-gradient-to-b from-foreground/30 to-transparent" />
        </div>

        {cards.map((card, i) => {
          const targetScale = Math.max(0.5, 1 - (cards.length - i - 1) * 0.1);
          return (
            <StickyScrollCard
              key={`card_${i}`}
              i={i}
              {...card}
              progress={scrollYProgress}
              range={[i * 0.25, 1]}
              targetScale={targetScale}
            />
          );
        })}
      </main>
    </ReactLenis>
  );
}
```

## Usage

```tsx
import { StickyScrollCards } from "@/components/ui/sticky-scroll-cards";

export default function Page() {
  return <StickyScrollCards />;
}
```

## API Reference (Props)

| Prop        | Type                     | Default                           | Description                                                                                                              |
| ----------- | ------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `cards`     | `StickyScrollCardItem[]` | -                                 | Array of card objects. Each item requires a title (string) and src (image URL). Defaults to 5 Unsplash landscape photos. |
| `hint`      | `string`                 | `"scroll down to see card stack"` | Short hint label shown above the card stack before scrolling begins.                                                     |
| `className` | `string`                 | -                                 | Additional CSS classes applied to the outer container.                                                                   |

---

_Component from [Componentry](https://componentry.dev/docs/components/sticky-scroll-cards)_

# A great way to introduce the user with a grouping of inspo photos or perhaps a grouping of design tools

# Scroll Split Card

A scroll-driven interactive card component that separates into three panels and flips to reveal custom content, inspired by high-end landing page motion.

## Installation

```bash
npx componentry@latest add scroll-split-card
```

## Usage

```tsx
import { useRef } from "react"
import { ScrollSplitCard } from "@/components/ui/scroll-split-card"

export function Example() {
  const containerRef = useRef<HTMLDivElement>(null)

  return (
    <div ref={containerRef} className="h-full w-full overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
      <ScrollSplitCard
        containerRef={containerRef}
        imageSrc="https://images.unsplash.com/photo-1773058373644-74e4120bfc77?q=80&w=2832&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D"
        cards={[
        {
          title: "Going Zero to One",
          description: "If you've navigating a new business... breaking into a new market.",
          bgColor: "#e2e2e2",
          textColor: "#111111"
        },
        {
          title: "Scaling from One to N",
          description: "If you've achieved Product/Market Fit...",
          bgColor: "#1a5bcf",
          textColor: "#ffffff"
        },
        {
          title: "Need Quick Solutions",
          description: "If you know exactly what you want and need...",
          bgColor: "#1c1c1c",
          textColor: "#ffffff"
        }
      ]}
    />
  )
}
```

---

_Component from [Componentry](https://componentry.dev/docs/components/scroll-split-card)_

# Any number of ways to utilize this component ... its easy to see the photos but is also fun and different to scroll and surf

# Collection Surfer

A 3D scroll-driven collection viewer where items surf along a perspective track. Perfect for immersive showcases.

## Installation

```bash
npx componentry@latest add collection-surfer
```

**Dependencies:** framer-motion clsx tailwind-merge

## Source Code

```tsx
"use client";

import React, { useRef } from "react";
import {
  motion,
  useScroll,
  useTransform,
  useSpring,
  useMotionValue,
  MotionValue,
} from "framer-motion";

export interface CollectionItem {
  id: number;
  image: string;
  title: string;
}

export type CollectionSurferVariant = "magnetic" | "uplift" | "simple";

// Default items for the component in case none are provided
const ITEMS: CollectionItem[] = [
  {
    id: 1,
    image:
      "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=800&q=80",
    title: "HERITAGE 01",
  },
  {
    id: 2,
    image:
      "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800&q=80",
    title: "HERITAGE 02",
  },
  {
    id: 3,
    image:
      "https://images.unsplash.com/photo-1483985988355-763728e1935b?w=800&q=80",
    title: "HERITAGE 03",
  },
  {
    id: 4,
    image:
      "https://images.unsplash.com/photo-1500917293891-ef795e70e1f6?w=800&q=80",
    title: "HERITAGE 04",
  },
  {
    id: 5,
    image:
      "https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=800&q=80",
    title: "HERITAGE 05",
  },
  {
    id: 6,
    image:
      "https://images.unsplash.com/photo-1532453288672-3a27e9be9efd?w=800&q=80",
    title: "HERITAGE 06",
  },
  {
    id: 7,
    image:
      "https://images.unsplash.com/photo-1552374196-1ab2a1c593e8?w=800&q=80",
    title: "HERITAGE 07",
  },
  {
    id: 8,
    image:
      "https://images.unsplash.com/photo-1509631179647-0177331693ae?w=800&q=80",
    title: "HERITAGE 08",
  },
  {
    id: 9,
    image:
      "https://images.unsplash.com/photo-1502716119720-b23a93e5fe1b?w=800&q=80",
    title: "HERITAGE 09",
  },
  {
    id: 10,
    image:
      "https://images.unsplash.com/photo-1539008835657-9e8e9680c956?w=800&q=80",
    title: "HERITAGE 10",
  },
  {
    id: 11,
    image:
      "https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=800&q=80",
    title: "HERITAGE 11",
  },
  {
    id: 12,
    image:
      "https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=800&q=80",
    title: "HERITAGE 12",
  },
  {
    id: 13,
    image:
      "https://images.unsplash.com/photo-1581044777550-4cfa60707c03?w=800&q=80",
    title: "HERITAGE 13",
  },
  {
    id: 14,
    image:
      "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=800&q=80",
    title: "HERITAGE 14",
  },
  {
    id: 15,
    image:
      "https://images.unsplash.com/photo-1496217590455-aa63a8350eea?w=800&q=80",
    title: "HERITAGE 15",
  },
  {
    id: 16,
    image:
      "https://images.unsplash.com/photo-1571513722275-4b41940f54b8?w=800&q=80",
    title: "HERITAGE 16",
  },
];

interface CollectionSurferProps {
  items?: CollectionItem[];
  variant?: CollectionSurferVariant;
}

export function CollectionSurfer({
  items = ITEMS,
  variant = "magnetic",
}: CollectionSurferProps) {
  // 1. Loop Setup: Duplicate items to create a buffer
  // We render the list twice: [Original Set, Duplicate Set]
  // When we scroll past the Original Set, we snap back to the start.
  const duplicatedItems = [...items, ...items];

  // Scroll sensitivity
  const scrollPerItem = 600;

  // The exact scroll distance to complete one full loop of the ORIGINAL items
  const loopDistance = items.length * scrollPerItem;

  const { scrollY } = useScroll();

  const smoothScroll = useSpring(scrollY, {
    mass: 0.1,
    stiffness: 100,
    damping: 20,
  });

  // 2. Modulo Logic:
  // Instead of mapping 0 -> totalScroll, we map to a looped value.
  // loops 0 -> loopDistance -> 0 -> loopDistance...
  const loopedProgress = useTransform(
    smoothScroll,
    (value) => value % loopDistance,
  );

  // Step vector
  const stepX = 240;
  const stepY = -84;
  const stepZ = -288;

  // We only move the scene backwards by the length of ONE set of items
  const x = useTransform(
    loopedProgress,
    [0, loopDistance],
    [0, -items.length * stepX],
  );
  const y = useTransform(
    loopedProgress,
    [0, loopDistance],
    [0, -items.length * stepY],
  );
  const z = useTransform(
    loopedProgress,
    [0, loopDistance],
    [0, -items.length * stepZ],
  );

  // Mouse position for magnetic effect
  // Initialize off-screen so no card is scaled by default
  const mouseX = useMotionValue(-10000);
  const mouseY = useMotionValue(-10000);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (variant === "simple") return;
    mouseX.set(e.clientX);
    mouseY.set(e.clientY);
  };

  const handleMouseLeave = () => {
    if (variant === "simple") return;
    mouseX.set(-10000);
    mouseY.set(-10000);
  };

  return (
    <div className="relative bg-black min-h-screen text-white w-full">
      {/* 3. Infinite Spacer: 
                We make this huge so the user can scroll for a very long time.
                (e.g., 50,000px) */}
      <div style={{ height: "50000px" }} className="w-full" />

      {/* Fixed viewport */}
      <div
        className="fixed inset-0 w-full h-screen overflow-hidden flex items-center justify-center perspective-container"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* UI Overlays */}
        <div className="absolute top-[3vw] left-[3vw] z-50 pointer-events-none mix-blend-difference">
          <h1 className="font-heading font-bold text-[clamp(2rem,6vw,5rem)] leading-[0.9] tracking-tighter ml-[4vw]">
            HERITAGE FW25/26
          </h1>
          <h1 className="font-heading font-bold text-[clamp(2rem,6vw,5rem)] leading-[0.9] tracking-tighter">
            COLLECTION
            <span className="text-[0.4em] align-top relative top-[0.6em] ml-2 font-mono tabular-nums">
              ({items.length})
            </span>
          </h1>
        </div>

        <div className="absolute bottom-[3vw] right-[3vw] z-50 font-mono text-xs tracking-wider uppercase opacity-70">
          scroll to surf
        </div>

        {/* 3D Scene */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            perspective: "2000px",
            perspectiveOrigin: "10% 10%",
          }}
        >
          {/* Animated Track */}
          <motion.div
            className="relative w-0 h-0"
            style={{
              x,
              y,
              z,
              transformStyle: "preserve-3d",
            }}
          >
            {duplicatedItems.map((item, i) => (
              <Card
                key={`${item.id}-${i}`}
                item={item}
                i={i}
                stepX={stepX}
                stepY={stepY}
                stepZ={stepZ}
                mouseX={mouseX}
                mouseY={mouseY}
                scrollSpring={smoothScroll}
                variant={variant}
              />
            ))}
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function Card({
  item,
  i,
  stepX,
  stepY,
  stepZ,
  mouseX,
  mouseY,
  scrollSpring,
  variant,
}: {
  item: CollectionItem;
  i: number;
  stepX: number;
  stepY: number;
  stepZ: number;
  mouseX: MotionValue<number>;
  mouseY: MotionValue<number>;
  scrollSpring: MotionValue<number>;
  variant: CollectionSurferVariant;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Calculate distance from mouse to center of card
  const distance = useTransform([mouseX, mouseY, scrollSpring], ([x, y]) => {
    if (!ref.current || variant === "simple") return 200; // Default large distance
    const rect = ref.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dist = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));
    return dist;
  });

  // --- Magnetic Variant ---
  // Map distance to scale: Closer = larger
  const targetScale = useTransform(distance, [0, 400], [1.5, 1]);
  const springScale = useSpring(targetScale, {
    mass: 0.5,
    stiffness: 300,
    damping: 20,
  });

  // --- Uplift Variant ---
  // Map distance to Y uplift: Closer = move up (negative Y)
  const targetUplift = useTransform(distance, [0, 400], [-100, 0]);
  const springUplift = useSpring(targetUplift, {
    mass: 0.5,
    stiffness: 300,
    damping: 20,
  });

  // Combine transforms based on variant
  const transform = useTransform([springScale, springUplift], ([s, u]) => {
    let scaleValue = 1;
    let upliftValue = 0;

    if (variant === "magnetic") {
      scaleValue = Number(s);
    } else if (variant === "uplift") {
      upliftValue = Number(u);
    }

    const baseX = i * stepX;
    const baseY = i * stepY;
    const baseZ = i * stepZ;

    return `translate3d(${baseX}px, ${baseY + upliftValue}px, ${baseZ}px) rotateY(-50deg) scale(${scaleValue})`;
  });

  return (
    <motion.div
      ref={ref}
      className="absolute w-[300px] h-[400px] bg-neutral-900 overflow-hidden shadow-2xl transition-colors duration-500 ease-out group"
      style={{
        transform,
        transformStyle: "preserve-3d",
      }}
    >
      {/* Index number: Using i % 16 + 1 so the duplicate cards show correct numbers (01-16) */}
      <div className="absolute -top-6 -left-4 text-white font-mono text-xs opacity-50 transition-opacity group-hover:opacity-100">
        {String((i % 16) + 1).padStart(2, "0")}
      </div>

      {/* Image */}
      <div className="relative w-full h-full brightness-75 group-hover:brightness-100 transition-all duration-300">
        <img
          src={item.image}
          alt={item.title}
          className="w-full h-full object-cover"
        />
      </div>

      <div className="absolute inset-0 bg-gradient-to-tr from-black/20 to-transparent pointer-events-none" />
    </motion.div>
  );
}
```

## Usage

```tsx
import {
  CollectionSurfer,
  CollectionItem,
} from "@/components/ui/collection-surfer";
```

## API Reference (Props)

| Prop      | Type               | Default  | Description                                                                                         |
| --------- | ------------------ | -------- | --------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `items`   | `CollectionItem[]` | -        | Array of items to display. Each item must have id (number), image (string URL), and title (string). |
| `variant` | `"magnetic"        | "uplift" | "simple"`                                                                                           | `"magnetic"` | Visual interaction style. 'magnetic' scales cards on hover, 'uplift' moves cards vertically, 'simple' has no hover effects. |

### Uplift

```tsx
import {
  CollectionSurfer,
  CollectionItem,
} from "@/components/ui/collection-surfer";

const ITEMS: CollectionItem[] = [
  // ... items
];

export default function Page() {
  return <CollectionSurfer items={ITEMS} variant="uplift" />;
}
```

### Simple

```tsx
import {
  CollectionSurfer,
  CollectionItem,
} from "@/components/ui/collection-surfer";

const ITEMS: CollectionItem[] = [
  // ... items
];

export default function Page() {
  return <CollectionSurfer items={ITEMS} variant="simple" />;
}
```

---

_Component from [Componentry](https://componentry.dev/docs/components/collection-surfer)_

# Another great way to keep the user entertained in between geminii photo edits

# Circuit Board

Animated circuit board visualization with nodes and connections. Perfect for tech diagrams and flow visualizations.

## Installation

```bash
npx componentry@latest add circuit-board
```

**Dependencies:** framer-motion clsx tailwind-merge lucide-react

## Source Code

```tsx
"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@workspace/ui/lib/utils";

interface CircuitNode {
  id: string;
  x: number;
  y: number;
  label?: string;
  icon?: React.ReactNode;
  status?: "active" | "inactive" | "processing" | "error";
  size?: "sm" | "md" | "lg";
}

interface CircuitConnection {
  from: string;
  to: string;
  animated?: boolean;
  bidirectional?: boolean;
  color?: string;
  pulseColor?: string;
}

interface CircuitBoardProps extends React.HTMLAttributes<HTMLDivElement> {
  nodes: CircuitNode[];
  connections: CircuitConnection[];
  width?: number;
  height?: number;
  gridSize?: number;
  showGrid?: boolean;
  gridColor?: string;
  traceColor?: string;
  pulseColor?: string;
  nodeColor?: string;
  pulseSpeed?: number;
  traceWidth?: number;
  /** Force a specific theme variant. Defaults to auto-detect from system. */
  variant?: "light" | "dark" | "auto";
}

function CircuitBoard({
  nodes,
  connections,
  width = 600,
  height = 400,
  gridSize = 20,
  showGrid = true,
  gridColor,
  traceColor,
  pulseColor,
  nodeColor,
  pulseSpeed = 2,
  traceWidth = 2,
  variant = "auto",
  className,
  ...props
}: CircuitBoardProps) {
  // Theme-aware color defaults
  const [isDark, setIsDark] = React.useState(true);

  React.useEffect(() => {
    if (variant !== "auto") {
      setIsDark(variant === "dark");
      return;
    }

    // Check for dark class on html/body
    const checkTheme = () => {
      const isDarkMode =
        document.documentElement.classList.contains("dark") ||
        document.body.classList.contains("dark");
      setIsDark(isDarkMode);
    };

    checkTheme();

    // Listen for changes
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", checkTheme);

    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener("change", checkTheme);
    };
  }, [variant]);

  // Compute theme-aware colors
  const computedGridColor =
    gridColor ||
    (isDark ? "rgba(163, 163, 163, 0.08)" : "rgba(64, 64, 64, 0.12)");
  const computedTraceColor =
    traceColor ||
    (isDark ? "rgba(163, 163, 163, 0.25)" : "rgba(64, 64, 64, 0.35)");
  const computedPulseColor =
    pulseColor ||
    (isDark ? "rgba(163, 163, 163, 0.6)" : "rgba(64, 64, 64, 0.7)");
  const computedNodeColor =
    nodeColor ||
    (isDark ? "rgba(163, 163, 163, 0.5)" : "rgba(64, 64, 64, 0.6)");
  const nodeMap = React.useMemo(() => {
    return new Map(nodes.map((node) => [node.id, node]));
  }, [nodes]);

  const getNodeSize = React.useCallback((size?: CircuitNode["size"]) => {
    switch (size) {
      case "sm":
        return 24;
      case "lg":
        return 48;
      default:
        return 36;
    }
  }, []);

  const calculatePath = React.useCallback(
    (from: CircuitNode, to: CircuitNode): string => {
      const fromSize = getNodeSize(from.size) / 2 + 4;
      const toSize = getNodeSize(to.size) / 2 + 4;

      const dx = to.x - from.x;
      const dy = to.y - from.y;

      // Calculate start and end points offset from node centers
      let startX = from.x;
      let startY = from.y;
      let endX = to.x;
      let endY = to.y;

      // Create circuit-like paths with right angles
      if (Math.abs(dx) > Math.abs(dy)) {
        // Horizontal first, then vertical
        startX = from.x + (dx > 0 ? fromSize : -fromSize);
        endX = to.x + (dx > 0 ? -toSize : toSize);
        const midX = from.x + dx / 2;
        return `M ${startX} ${startY} H ${midX} V ${endY} H ${endX}`;
      } else {
        // Vertical first, then horizontal
        startY = from.y + (dy > 0 ? fromSize : -fromSize);
        endY = to.y + (dy > 0 ? -toSize : toSize);
        const midY = from.y + dy / 2;
        return `M ${startX} ${startY} V ${midY} H ${endX} V ${endY}`;
      }
    },
    [getNodeSize],
  );

  const getStatusColor = (status?: CircuitNode["status"]) => {
    if (isDark) {
      switch (status) {
        case "active":
          return "rgba(163, 163, 163, 0.7)";
        case "processing":
          return "rgba(163, 163, 163, 0.5)";
        case "error":
          return "rgba(120, 113, 108, 0.6)";
        default:
          return computedNodeColor;
      }
    } else {
      switch (status) {
        case "active":
          return "rgba(64, 64, 64, 0.8)";
        case "processing":
          return "rgba(64, 64, 64, 0.6)";
        case "error":
          return "rgba(180, 83, 83, 0.7)";
        default:
          return computedNodeColor;
      }
    }
  };

  return (
    <div
      className={cn("relative overflow-hidden", className)}
      style={{ width, height }}
      {...props}
    >
      <svg
        width={width}
        height={height}
        className="absolute inset-0"
        style={{ overflow: "visible" }}
      >
        <defs>
          {/* Glow filter for the pulse effect */}
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Grid pattern */}
          {showGrid && (
            <pattern
              id="circuitGrid"
              width={gridSize}
              height={gridSize}
              patternUnits="userSpaceOnUse"
            >
              <circle
                cx={gridSize / 2}
                cy={gridSize / 2}
                r="0.5"
                fill={computedGridColor}
              />
            </pattern>
          )}

          {/* Animated gradient for electricity effect */}
          {connections.map((conn, i) => (
            <linearGradient
              key={`gradient-${i}`}
              id={`electricGradient-${i}`}
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="transparent" />
              <stop offset="40%" stopColor="transparent" />
              <stop
                offset="50%"
                stopColor={conn.pulseColor || computedPulseColor}
              />
              <stop offset="60%" stopColor="transparent" />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
          ))}
        </defs>

        {/* Grid background */}
        {showGrid && (
          <rect width={width} height={height} fill="url(#circuitGrid)" />
        )}

        {/* Connection traces */}
        {connections.map((conn, i) => {
          const fromNode = nodeMap.get(conn.from);
          const toNode = nodeMap.get(conn.to);
          if (!fromNode || !toNode) return null;

          const path = calculatePath(fromNode, toNode);
          const pathLength = 500; // Approximate path length for animation

          return (
            <g key={`connection-${i}`}>
              {/* Base trace */}
              <motion.path
                d={path}
                fill="none"
                stroke={conn.color || computedTraceColor}
                strokeWidth={traceWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 1, delay: i * 0.2 }}
              />

              {/* Animated electricity pulse */}
              {conn.animated !== false && (
                <motion.path
                  d={path}
                  fill="none"
                  stroke={conn.pulseColor || computedPulseColor}
                  strokeWidth={traceWidth + 2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  filter="url(#glow)"
                  strokeDasharray={`${pathLength * 0.1} ${pathLength * 0.9}`}
                  initial={{ strokeDashoffset: pathLength }}
                  animate={{ strokeDashoffset: -pathLength }}
                  transition={{
                    duration: pulseSpeed,
                    repeat: Infinity,
                    ease: "linear",
                    delay: i * 0.3,
                  }}
                />
              )}

              {/* Bidirectional pulse */}
              {conn.bidirectional && (
                <motion.path
                  d={path}
                  fill="none"
                  stroke={conn.pulseColor || computedPulseColor}
                  strokeWidth={traceWidth + 2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  filter="url(#glow)"
                  strokeDasharray={`${pathLength * 0.1} ${pathLength * 0.9}`}
                  initial={{ strokeDashoffset: -pathLength }}
                  animate={{ strokeDashoffset: pathLength }}
                  transition={{
                    duration: pulseSpeed,
                    repeat: Infinity,
                    ease: "linear",
                    delay: i * 0.3 + pulseSpeed / 2,
                  }}
                />
              )}
            </g>
          );
        })}
      </svg>

      {/* Nodes */}
      {nodes.map((node, i) => {
        const size = getNodeSize(node.size);
        const statusColor = getStatusColor(node.status);

        return (
          <motion.div
            key={node.id}
            className="absolute flex items-center justify-center"
            style={{
              left: node.x - size / 2,
              top: node.y - size / 2,
              width: size,
              height: size,
            }}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: i * 0.1 + 0.5, type: "spring" }}
          >
            {/* Node background with pulse */}
            <motion.div
              className="absolute inset-0 rounded-lg"
              style={{ backgroundColor: statusColor }}
              animate={
                node.status === "processing"
                  ? { opacity: [0.2, 0.5, 0.2] }
                  : { opacity: 0.2 }
              }
              transition={
                node.status === "processing"
                  ? { duration: 1.5, repeat: Infinity }
                  : {}
              }
            />

            {/* Node border */}
            <div
              className="absolute inset-0 rounded-lg border-2"
              style={{ borderColor: statusColor }}
            />

            {/* Inner glow for active nodes */}
            {node.status === "active" && (
              <motion.div
                className="absolute inset-0 rounded-lg"
                style={{
                  boxShadow: `0 0 20px ${statusColor}40, inset 0 0 10px ${statusColor}20`,
                }}
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
            )}

            {/* Node content */}
            <div className="relative z-10 flex flex-col items-center justify-center">
              {node.icon && (
                <div style={{ color: statusColor }}>{node.icon}</div>
              )}
            </div>

            {/* Label */}
            {node.label && (
              <div
                className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs font-medium"
                style={{ color: statusColor }}
              >
                {node.label}
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

// Pre-built circuit patterns
interface CircuitPatternProps extends Omit<
  CircuitBoardProps,
  "nodes" | "connections"
> {
  pattern: "data-flow" | "network" | "processor" | "tree";
}

function CircuitPattern({ pattern, ...props }: CircuitPatternProps) {
  const patterns = {
    "data-flow": {
      nodes: [
        {
          id: "input",
          x: 50,
          y: 200,
          label: "Input",
          status: "active" as const,
        },
        {
          id: "process1",
          x: 200,
          y: 100,
          label: "Process",
          status: "processing" as const,
        },
        {
          id: "process2",
          x: 200,
          y: 300,
          label: "Validate",
          status: "active" as const,
        },
        {
          id: "merge",
          x: 400,
          y: 200,
          label: "Merge",
          status: "active" as const,
        },
        {
          id: "output",
          x: 550,
          y: 200,
          label: "Output",
          status: "active" as const,
        },
      ],
      connections: [
        { from: "input", to: "process1", animated: true },
        { from: "input", to: "process2", animated: true },
        { from: "process1", to: "merge", animated: true },
        { from: "process2", to: "merge", animated: true },
        { from: "merge", to: "output", animated: true },
      ],
    },
    network: {
      nodes: [
        {
          id: "server",
          x: 300,
          y: 80,
          label: "Server",
          status: "active" as const,
          size: "lg" as const,
        },
        {
          id: "client1",
          x: 100,
          y: 200,
          label: "Client 1",
          status: "active" as const,
        },
        {
          id: "client2",
          x: 300,
          y: 250,
          label: "Client 2",
          status: "processing" as const,
        },
        {
          id: "client3",
          x: 500,
          y: 200,
          label: "Client 3",
          status: "active" as const,
        },
        {
          id: "db",
          x: 300,
          y: 350,
          label: "Database",
          status: "active" as const,
        },
      ],
      connections: [
        { from: "server", to: "client1", bidirectional: true },
        { from: "server", to: "client2", bidirectional: true },
        { from: "server", to: "client3", bidirectional: true },
        { from: "server", to: "db", bidirectional: true },
      ],
    },
    processor: {
      nodes: [
        {
          id: "alu",
          x: 300,
          y: 200,
          label: "ALU",
          status: "processing" as const,
          size: "lg" as const,
        },
        {
          id: "reg1",
          x: 150,
          y: 100,
          label: "R1",
          status: "active" as const,
          size: "sm" as const,
        },
        {
          id: "reg2",
          x: 150,
          y: 200,
          label: "R2",
          status: "active" as const,
          size: "sm" as const,
        },
        {
          id: "reg3",
          x: 150,
          y: 300,
          label: "R3",
          status: "active" as const,
          size: "sm" as const,
        },
        {
          id: "cache",
          x: 450,
          y: 200,
          label: "Cache",
          status: "active" as const,
        },
        {
          id: "out",
          x: 550,
          y: 200,
          label: "Out",
          status: "active" as const,
          size: "sm" as const,
        },
      ],
      connections: [
        { from: "reg1", to: "alu", animated: true },
        { from: "reg2", to: "alu", animated: true },
        { from: "reg3", to: "alu", animated: true },
        { from: "alu", to: "cache", animated: true },
        { from: "cache", to: "out", animated: true },
      ],
    },
    tree: {
      nodes: [
        { id: "root", x: 300, y: 50, label: "Root", status: "active" as const },
        { id: "l1", x: 150, y: 150, label: "L1", status: "active" as const },
        {
          id: "r1",
          x: 450,
          y: 150,
          label: "R1",
          status: "processing" as const,
        },
        {
          id: "l1l",
          x: 80,
          y: 280,
          label: "L1L",
          status: "active" as const,
          size: "sm" as const,
        },
        {
          id: "l1r",
          x: 220,
          y: 280,
          label: "L1R",
          status: "active" as const,
          size: "sm" as const,
        },
        {
          id: "r1l",
          x: 380,
          y: 280,
          label: "R1L",
          status: "error" as const,
          size: "sm" as const,
        },
        {
          id: "r1r",
          x: 520,
          y: 280,
          label: "R1R",
          status: "active" as const,
          size: "sm" as const,
        },
      ],
      connections: [
        { from: "root", to: "l1", animated: true },
        { from: "root", to: "r1", animated: true },
        { from: "l1", to: "l1l", animated: true },
        { from: "l1", to: "l1r", animated: true },
        { from: "r1", to: "r1l", animated: true },
        { from: "r1", to: "r1r", animated: true },
      ],
    },
  };

  const selectedPattern = patterns[pattern];
  return (
    <CircuitBoard
      nodes={selectedPattern.nodes}
      connections={selectedPattern.connections}
      {...props}
    />
  );
}

// Interactive circuit node for building custom circuits
interface CircuitNodeComponentProps {
  status?: "active" | "inactive" | "processing" | "error";
  size?: "sm" | "md" | "lg";
  glowColor?: string;
  children?: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

function CircuitNode({
  status = "inactive",
  size = "md",
  glowColor,
  children,
  className,
  onClick,
}: CircuitNodeComponentProps) {
  const [isDark, setIsDark] = React.useState(true);

  React.useEffect(() => {
    const checkTheme = () => {
      const isDarkMode =
        document.documentElement.classList.contains("dark") ||
        document.body.classList.contains("dark");
      setIsDark(isDarkMode);
    };

    checkTheme();

    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", checkTheme);

    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener("change", checkTheme);
    };
  }, []);

  const sizeClasses = {
    sm: "w-8 h-8",
    md: "w-12 h-12",
    lg: "w-16 h-16",
  };

  const statusColors = isDark
    ? {
        active: "rgba(163, 163, 163, 0.7)",
        inactive: "rgba(115, 115, 115, 0.4)",
        processing: "rgba(163, 163, 163, 0.5)",
        error: "rgba(120, 113, 108, 0.6)",
      }
    : {
        active: "rgba(64, 64, 64, 0.8)",
        inactive: "rgba(100, 100, 100, 0.5)",
        processing: "rgba(64, 64, 64, 0.6)",
        error: "rgba(180, 83, 83, 0.7)",
      };

  const color = glowColor || statusColors[status];

  return (
    <motion.div
      className={cn(
        "relative flex items-center justify-center rounded-lg border",
        isDark ? "bg-neutral-900/50" : "bg-neutral-200/60",
        sizeClasses[size],
        className,
      )}
      style={{ borderColor: color }}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
    >
      {/* Pulse animation for processing state */}
      {status === "processing" && (
        <motion.div
          className="absolute inset-0 rounded-lg"
          style={{ backgroundColor: color }}
          animate={{ opacity: [0.1, 0.3, 0.1] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
      )}

      {/* Active glow */}
      {status === "active" && (
        <div
          className="absolute inset-0 rounded-lg"
          style={{
            boxShadow: `0 0 20px ${color}60, 0 0 40px ${color}30`,
          }}
        />
      )}

      {/* Error pulse */}
      {status === "error" && (
        <motion.div
          className="absolute inset-0 rounded-lg"
          style={{ boxShadow: `0 0 20px ${color}80` }}
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 0.5, repeat: Infinity }}
        />
      )}

      <div className="relative z-10" style={{ color }}>
        {children}
      </div>
    </motion.div>
  );
}

// Animated trace line component for custom layouts
interface CircuitTraceProps {
  path: string;
  animated?: boolean;
  color?: string;
  pulseColor?: string;
  width?: number;
  pulseSpeed?: number;
}

function CircuitTrace({
  path,
  animated = true,
  color,
  pulseColor,
  width = 2,
  pulseSpeed = 2,
}: CircuitTraceProps) {
  const [isDark, setIsDark] = React.useState(true);

  React.useEffect(() => {
    const checkTheme = () => {
      const isDarkMode =
        document.documentElement.classList.contains("dark") ||
        document.body.classList.contains("dark");
      setIsDark(isDarkMode);
    };

    checkTheme();

    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", checkTheme);

    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener("change", checkTheme);
    };
  }, []);

  const computedColor =
    color || (isDark ? "rgba(163, 163, 163, 0.25)" : "rgba(64, 64, 64, 0.35)");
  const computedPulseColor =
    pulseColor ||
    (isDark ? "rgba(163, 163, 163, 0.6)" : "rgba(64, 64, 64, 0.7)");
  const pathLength = 500;

  return (
    <svg className="absolute inset-0 overflow-visible pointer-events-none">
      <defs>
        <filter id="traceGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Base trace */}
      <motion.path
        d={path}
        fill="none"
        stroke={computedColor}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1 }}
      />

      {/* Animated pulse */}
      {animated && (
        <motion.path
          d={path}
          fill="none"
          stroke={computedPulseColor}
          strokeWidth={width + 2}
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#traceGlow)"
          strokeDasharray={`${pathLength * 0.1} ${pathLength * 0.9}`}
          initial={{ strokeDashoffset: pathLength }}
          animate={{ strokeDashoffset: -pathLength }}
          transition={{
            duration: pulseSpeed,
            repeat: Infinity,
            ease: "linear",
          }}
        />
      )}
    </svg>
  );
}

export {
  CircuitBoard,
  CircuitPattern,
  CircuitNode,
  CircuitTrace,
  type CircuitNode as CircuitNodeType,
  type CircuitConnection,
  type CircuitBoardProps,
};
```

## Usage

```tsx
import { CircuitBoard } from "@/components/ui/circuit-board";
import { Cloud, Server, Shield, Database } from "lucide-react";

<CircuitBoard
  nodes={[
    {
      id: "start",
      x: 80,
      y: 150,
      label: "Cloud",
      icon: <Cloud className="w-4 h-4" />,
    },
    {
      id: "process",
      x: 250,
      y: 80,
      label: "Server",
      icon: <Server className="w-4 h-4" />,
    },
    {
      id: "validate",
      x: 250,
      y: 220,
      label: "Validate",
      icon: <Shield className="w-4 h-4" />,
    },
    {
      id: "end",
      x: 420,
      y: 150,
      label: "Database",
      icon: <Database className="w-4 h-4" />,
    },
  ]}
  connections={[
    { from: "start", to: "process", animated: true },
    { from: "start", to: "validate", animated: true },
    { from: "process", to: "end", animated: true },
    { from: "validate", to: "end", animated: true },
  ]}
  width={500}
  height={300}
/>;
```

## API Reference (Props)

| Prop          | Type                  | Default | Description                                                        |
| ------------- | --------------------- | ------- | ------------------------------------------------------------------ |
| `nodes`       | `CircuitNode[]`       | -       | Array of node objects with id, x, y, label, size, and icon         |
| `connections` | `CircuitConnection[]` | -       | Array of connection objects with from, to, animated, bidirectional |
| `width`       | `number`              | `600`   | Width of the circuit board canvas                                  |
| `height`      | `number`              | `400`   | Height of the circuit board canvas                                 |
| `showGrid`    | `boolean`             | `true`  | Show dot grid background                                           |
| `pulseSpeed`  | `number`              | `2`     | Speed of the electricity animation in seconds                      |
| `traceWidth`  | `number`              | `2`     | Width of the connection traces in pixels                           |
| `className`   | `string`              | -       | Additional CSS classes for the container                           |

### Simple Flow

```tsx
import { CircuitBoard } from "@/components/ui/circuit-board";
import { Cloud, Server, Shield, Database } from "lucide-react";

<CircuitBoard
  nodes={[
    {
      id: "start",
      x: 80,
      y: 150,
      label: "Cloud",
      icon: <Cloud className="w-4 h-4" />,
    },
    {
      id: "process",
      x: 250,
      y: 80,
      label: "Server",
      icon: <Server className="w-4 h-4" />,
    },
    {
      id: "validate",
      x: 250,
      y: 220,
      label: "Validate",
      icon: <Shield className="w-4 h-4" />,
    },
    {
      id: "end",
      x: 420,
      y: 150,
      label: "Database",
      icon: <Database className="w-4 h-4" />,
    },
  ]}
  connections={[
    { from: "start", to: "process", animated: true },
    { from: "start", to: "validate", animated: true },
    { from: "process", to: "end", animated: true },
    { from: "validate", to: "end", animated: true },
  ]}
  width={500}
  height={300}
/>;
```

### Load Balancer

```tsx
import { CircuitBoard } from "@/components/ui/circuit-board";
import { Globe, GitBranch, Server, Database } from "lucide-react";

<CircuitBoard
  nodes={[
    {
      id: "user",
      x: 60,
      y: 150,
      label: "User",
      icon: <Globe className="w-4 h-4" />,
    },
    {
      id: "lb",
      x: 180,
      y: 150,
      label: "Load Balancer",
      icon: <GitBranch className="w-4 h-4" />,
    },
    {
      id: "api1",
      x: 300,
      y: 80,
      label: "API 1",
      icon: <Server className="w-4 h-4" />,
    },
    {
      id: "api2",
      x: 300,
      y: 220,
      label: "API 2",
      icon: <Server className="w-4 h-4" />,
    },
    {
      id: "db",
      x: 420,
      y: 150,
      label: "Database",
      icon: <Database className="w-4 h-4" />,
    },
  ]}
  connections={[
    { from: "user", to: "lb", animated: true },
    { from: "lb", to: "api1", animated: true },
    { from: "lb", to: "api2", animated: true },
    { from: "api1", to: "db", animated: true },
    { from: "api2", to: "db", animated: true },
  ]}
  width={480}
  height={300}
/>;
```

### Bidirectional

```tsx
import { CircuitBoard } from "@/components/ui/circuit-board";
import { Cpu, HardDrive, Database } from "lucide-react";

<CircuitBoard
  nodes={[
    {
      id: "cpu",
      x: 100,
      y: 100,
      label: "CPU",
      icon: <Cpu className="w-4 h-4" />,
    },
    {
      id: "ram",
      x: 250,
      y: 100,
      label: "RAM",
      icon: <HardDrive className="w-4 h-4" />,
    },
    {
      id: "storage",
      x: 400,
      y: 100,
      label: "Storage",
      icon: <Database className="w-4 h-4" />,
    },
  ]}
  connections={[
    { from: "cpu", to: "ram", bidirectional: true },
    { from: "ram", to: "storage", bidirectional: true },
  ]}
  width={500}
  height={200}
  showGrid={false}
/>;
```

### Network Topology

```tsx
import { CircuitBoard } from "@/components/ui/circuit-board";
import { Wifi, Server, Globe } from "lucide-react";

<CircuitBoard
  nodes={[
    {
      id: "router",
      x: 240,
      y: 100,
      label: "Router",
      icon: <Wifi className="w-4 h-4" />,
    },
    {
      id: "server1",
      x: 100,
      y: 220,
      label: "Server 1",
      icon: <Server className="w-4 h-4" />,
    },
    {
      id: "server2",
      x: 240,
      y: 220,
      label: "Server 2",
      icon: <Server className="w-4 h-4" />,
    },
    {
      id: "server3",
      x: 380,
      y: 220,
      label: "Server 3",
      icon: <Server className="w-4 h-4" />,
    },
  ]}
  connections={[
    { from: "router", to: "server1", animated: true },
    { from: "router", to: "server2", animated: true },
    { from: "router", to: "server3", animated: true },
  ]}
  width={480}
  height={300}
  pulseSpeed={1.5}
/>;
```

---

_Component from [Componentry](https://componentry.dev/docs/components/circuit-board)_

# Another great way to prepare the design center with additional stackable animated cards for organizingg inspo photos

# Orbit Card Stack

A premium interactive card stack that collapses into a tight deck, fans out on hover, and lifts the active card above the rest without changing its color or angle.

## Installation

```bash
npx componentry@latest add orbit-card-stack
```

**Dependencies:** framer-motion lucide-react clsx tailwind-merge

## Source Code

```tsx
"use client";

import { cn } from "@/lib/utils";
import { ArrowUpRight } from "lucide-react";
import { motion, useReducedMotion, type Transition } from "framer-motion";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

export interface OrbitStackItem {
  name: string;
  role: string;
  description: string;
  accent?: string;
  initials?: string;
  stat?: string;
  image?: string;
}

interface OrbitCardStackProps {
  /** Cards shown in the stack. */
  items?: OrbitStackItem[];
  /** Additional CSS classes for the outer stage. */
  className?: string;
  /** Additional CSS classes for each card. */
  cardClassName?: string;
  /** Card that sits at the front when the stack is collapsed. */
  defaultActiveIndex?: number;
  /** Horizontal fan distance in pixels. */
  spread?: number;
  /** Vertical lift for hovered cards in pixels. */
  lift?: number;
  /** Called when the active card changes. */
  onActiveChange?: (item: OrbitStackItem, index: number) => void;
}

const defaultItems: OrbitStackItem[] = [
  {
    name: "Mira Vale",
    role: "Creative Lead",
    description:
      "Shapes visual systems with enough restraint to feel expensive and enough edge to be remembered.",
    accent: "#f8d66d",
    initials: "MV",
    stat: "Identity",
    image: "/images/orbit-card-stack/mira-vale.png",
  },
  {
    name: "Noor Kade",
    role: "Product Strategy",
    description:
      "Turns loose ideas into sharp product moves, crisp priorities, and launchable experiences.",
    accent: "#78dcca",
    initials: "NK",
    stat: "Roadmap",
    image: "/images/orbit-card-stack/noor-kade.png",
  },
  {
    name: "Ari Chen",
    role: "Founder",
    description:
      "Sets the taste bar, protects the details, and keeps the whole team pointed at the same high signal.",
    accent: "#f3f1ea",
    initials: "AC",
    stat: "Vision",
    image: "/images/orbit-card-stack/ari-chen.png",
  },
  {
    name: "Sana Holt",
    role: "Frontend Engineer",
    description:
      "Builds the motion, polish, and interface texture that make the product feel calm under pressure.",
    accent: "#b9a7ff",
    initials: "SH",
    stat: "Motion",
    image: "/images/orbit-card-stack/sana-holt.png",
  },
  {
    name: "Ezra Moon",
    role: "Operations",
    description:
      "Keeps the machine quiet, the handoffs clean, and the team moving without pointless friction.",
    accent: "#ff9d77",
    initials: "EM",
    stat: "Systems",
    image: "/images/orbit-card-stack/ezra-moon.png",
  },
];

function clampIndex(index: number, length: number) {
  return Math.min(Math.max(index, 0), Math.max(length - 1, 0));
}

function getInitials(item: OrbitStackItem) {
  if (item.initials) return item.initials;
  return item.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function Portrait({ item }: { item: OrbitStackItem }) {
  const initials = getInitials(item);

  if (item.image) {
    return (
      <div className="relative flex aspect-[1.36] w-full overflow-hidden rounded-[1.45rem] border border-black/[0.08] bg-black/[0.045]">
        <img
          src={item.image}
          alt={item.name}
          className="h-full w-full object-cover"
        />
        <div className="absolute bottom-4 right-4 rounded-full bg-zinc-950 px-3 py-1 text-xs font-semibold tracking-[0.18em] text-white">
          {initials}
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative flex aspect-[1.36] w-full overflow-hidden rounded-[1.45rem] border border-black/[0.08] bg-black/[0.045]"
      style={{ "--accent": item.accent ?? "#f3f1ea" } as CSSProperties}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_20%,var(--accent),transparent_24%),radial-gradient(circle_at_85%_72%,rgba(255,255,255,0.5),transparent_28%)] opacity-45" />
      <div className="absolute inset-x-8 bottom-0 h-[72%] rounded-t-[999px] border-2 border-zinc-950 bg-[#f7f5ef]" />
      <div className="absolute left-1/2 top-[22%] size-24 -translate-x-1/2 rounded-[45%_55%_48%_52%] border-2 border-zinc-950 bg-[#f5f2eb]">
        <div className="absolute left-1/2 top-[42%] h-2 w-10 -translate-x-1/2 rounded-full bg-zinc-950 opacity-80" />
        <div className="absolute left-[27%] top-[34%] size-2 rounded-full bg-zinc-950" />
        <div className="absolute right-[27%] top-[34%] size-2 rounded-full bg-zinc-950" />
        <div className="absolute left-1/2 top-[52%] h-6 w-4 -translate-x-1/2 rounded-b-full border-b-2 border-zinc-950" />
        <div
          className="absolute -top-5 left-1/2 h-9 w-24 -translate-x-1/2 rounded-t-full border-2 border-b-0 border-zinc-950"
          style={{ backgroundColor: item.accent ?? "#f3f1ea" }}
        />
      </div>
      <div className="absolute bottom-4 right-4 rounded-full bg-zinc-950 px-3 py-1 text-xs font-semibold tracking-[0.18em] text-white">
        {initials}
      </div>
    </div>
  );
}

export function OrbitCardStack({
  items = defaultItems,
  className,
  cardClassName,
  defaultActiveIndex = 2,
  spread = 168,
  lift = 34,
  onActiveChange,
}: OrbitCardStackProps) {
  const shouldReduceMotion = useReducedMotion();
  const safeItems = items.length ? items : defaultItems;
  const defaultIndex = clampIndex(defaultActiveIndex, safeItems.length);
  const [expanded, setExpanded] = useState(false);
  const [activeIndex, setActiveIndex] = useState(defaultIndex);
  const [raisedIndex, setRaisedIndex] = useState(defaultIndex);
  const raiseTimeoutRef = useRef<number | null>(null);

  const center = (safeItems.length - 1) / 2;
  const transition: Transition = shouldReduceMotion
    ? { duration: 0.01 }
    : { type: "spring", stiffness: 350, damping: 30, mass: 0.7 };

  const collapseTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (raiseTimeoutRef.current) {
        window.clearTimeout(raiseTimeoutRef.current);
      }
      if (collapseTimeoutRef.current) {
        window.clearTimeout(collapseTimeoutRef.current);
      }
    };
  }, []);

  const activateCard = (item: OrbitStackItem, index: number) => {
    setActiveIndex(index);
    onActiveChange?.(item, index);

    if (raiseTimeoutRef.current) {
      window.clearTimeout(raiseTimeoutRef.current);
    }

    raiseTimeoutRef.current = window.setTimeout(
      () => {
        setRaisedIndex(index);
      },
      shouldReduceMotion ? 0 : 45,
    );
  };

  const scheduleCollapse = () => {
    if (collapseTimeoutRef.current) {
      window.clearTimeout(collapseTimeoutRef.current);
    }
    collapseTimeoutRef.current = window.setTimeout(() => {
      setExpanded(false);
      setActiveIndex(defaultIndex);
      setRaisedIndex(defaultIndex);
    }, 80);
  };

  const cancelCollapse = () => {
    if (collapseTimeoutRef.current) {
      window.clearTimeout(collapseTimeoutRef.current);
      collapseTimeoutRef.current = null;
    }
  };

  const cardLayouts = useMemo(
    () =>
      safeItems.map((_, index) => {
        const fromCenter = index - center;
        const collapsedFromActive = index - defaultIndex;
        const expandedRotate = fromCenter * 8.5;

        return {
          collapsed: {
            x: collapsedFromActive * 10,
            y: Math.abs(collapsedFromActive) * 5,
            rotate: collapsedFromActive * 2.8,
          },
          expanded: {
            x: fromCenter * spread,
            y:
              Math.abs(fromCenter) * 30 +
              Math.max(0, Math.abs(fromCenter) - 1) * 10,
            rotate: expandedRotate,
          },
        };
      }),
    [center, defaultIndex, safeItems, spread],
  );

  return (
    <div
      className={cn(
        "relative flex min-h-full w-full items-center justify-center overflow-hidden p-8",
        className,
      )}
    >
      <div className="relative h-[470px] w-full max-w-[980px]">
        {safeItems.map((item, index) => {
          const active = activeIndex === index;
          const cardLayout = cardLayouts[index] ?? cardLayouts[defaultIndex]!;
          const layout = expanded ? cardLayout.expanded : cardLayout.collapsed;
          const raised = raisedIndex === index;
          const zIndex = raised
            ? 80
            : expanded
              ? 50 - Math.abs(index - raisedIndex)
              : 50 - Math.abs(index - defaultIndex);

          return (
            <motion.article
              key={`${item.name}-${index}`}
              className={cn(
                "absolute left-1/2 top-1/2 w-[min(78vw,21rem)] origin-bottom cursor-pointer rounded-[1.9rem] border border-black/10 bg-[#e9e6df] p-4 text-[#141414] outline-none",
                "focus-visible:ring-2 focus-visible:ring-zinc-950/20 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                cardClassName,
              )}
              style={{ zIndex }}
              animate={{
                x: `calc(-50% + ${layout.x}px)`,
                y: `calc(-50% + ${layout.y - (active && expanded ? lift : 0)}px)`,
                rotate: layout.rotate,
                scale: expanded ? 0.985 : 0.97,
              }}
              transition={transition}
              tabIndex={0}
              onMouseEnter={() => {
                cancelCollapse();
                setExpanded(true);
                activateCard(item, index);
              }}
              onMouseLeave={scheduleCollapse}
              onFocus={() => {
                setExpanded(true);
                activateCard(item, index);
              }}
            >
              <div className="relative">
                <Portrait item={item} />
                <div className="absolute right-3 top-3 flex size-11 items-center justify-center rounded-full bg-zinc-950 text-white shadow-lg shadow-black/20">
                  <ArrowUpRight className="size-4" />
                </div>
              </div>

              <div className="px-2 pb-2 pt-6">
                <div>
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    {item.role}
                  </p>
                  <h3 className="mt-2 text-[2rem] font-semibold leading-none tracking-[-0.04em] text-zinc-950">
                    {item.name}
                  </h3>
                </div>
                <p className="mt-4 max-w-[17rem] text-[0.98rem] font-medium leading-[1.42] tracking-[-0.01em] text-zinc-700">
                  {item.description}
                </p>
                <div className="mt-5 border-t border-black/10 pt-4">
                  <span className="text-[0.68rem] font-bold uppercase tracking-[0.2em] text-zinc-500">
                    {item.stat ?? "Profile"}
                  </span>
                </div>
              </div>
            </motion.article>
          );
        })}
      </div>
    </div>
  );
}
```

## Usage

```tsx
const team: OrbitStackItem[] = [
  {
    name: "Mira Vale",
    role: "Creative Lead",
    description: "Shapes visual systems with restraint and edge.",
    initials: "MV",
    stat: "Identity",
    accent: "#f8d66d",
    image: "/team/mira-vale.png",
  },
  {
    name: "Noor Kade",
    role: "Product Strategy",
    description: "Turns loose ideas into crisp product moves.",
    initials: "NK",
    stat: "Roadmap",
    accent: "#78dcca",
    image: "/team/noor-kade.png",
  },
  {
    name: "Ari Chen",
    role: "Founder",
    description: "Keeps the team pointed at the same signal.",
    initials: "AC",
    stat: "Vision",
    accent: "#f3f1ea",
    image: "/team/ari-chen.png",
  },
];

export default function TeamPreview() {
  const [activeMember, setActiveMember] = useState(team[2]!);

  return (
    <section className="space-y-6">
      <div>
        <p className="text-sm font-medium text-muted-foreground">
          Currently viewing
        </p>
        <h2 className="text-2xl font-semibold">{activeMember.name}</h2>
      </div>

      <div className="h-[620px] w-full">
        <OrbitCardStack
          items={team}
          defaultActiveIndex={2}
          spread={150}
          lift={40}
          onActiveChange={(item) => setActiveMember(item)}
        />
      </div>
    </section>
  );
}
```

## API Reference (Props)

| Prop                 | Type                                            | Default | Description                                                      |
| -------------------- | ----------------------------------------------- | ------- | ---------------------------------------------------------------- |
| `items`              | `OrbitStackItem[]`                              | -       | Cards shown in the stack. Each item can include an `image` path. |
| `defaultActiveIndex` | `number`                                        | `2`     | Card that sits at the front when the stack is collapsed.         |
| `spread`             | `number`                                        | `168`   | Horizontal fan distance in pixels.                               |
| `lift`               | `number`                                        | `34`    | Vertical lift for hovered cards in pixels.                       |
| `onActiveChange`     | `(item: OrbitStackItem, index: number) => void` | -       | Callback fired when the active card changes.                     |
| `className`          | `string`                                        | -       | Additional CSS classes for the outer stage.                      |
| `cardClassName`      | `string`                                        | -       | Additional CSS classes for each card.                            |

---

_Component from [Componentry](https://componentry.dev/docs/components/orbit-card-stack)_

# HER ARE SOME ADDITIONAL STACKABLE CARDS AND IMAGES TO UTILIZE

## Integrate the <Masonry /> component from React Bits

You are helping integrate an open-source React component into an existing application.

### Component: Masonry

### Variant: JavaScript + Tailwind

### Dependencies: gsap

---

### Usage Example

```jsx
import Masonry from "./Masonry";

const items = [
  {
    id: "1",
    img: "https://picsum.photos/id/1015/600/900?grayscale",
    url: "https://example.com/one",
    height: 400,
  },
  {
    id: "2",
    img: "https://picsum.photos/id/1011/600/750?grayscale",
    url: "https://example.com/two",
    height: 250,
  },
  {
    id: "3",
    img: "https://picsum.photos/id/1020/600/800?grayscale",
    url: "https://example.com/three",
    height: 600,
  },
  // ... more items
];

<Masonry
  items={items}
  ease="power3.out"
  duration={0.6}
  stagger={0.05}
  animateFrom="bottom"
  scaleOnHover={true}
  hoverScale={0.95}
  blurToFocus={true}
  colorShiftOnHover={false}
/>;
```

### Props

| Prop              | Type    | Default      | Description                                                                                                 |
| ----------------- | ------- | ------------ | ----------------------------------------------------------------------------------------------------------- |
| items             | array   | required     | Array of items to display in the masonry layout. Each item should have id, img, url, and height properties. |
| ease              | string  | "power3.out" | GSAP easing function for animations.                                                                        |
| duration          | number  | 0.6          | Duration of the transition animations in seconds.                                                           |
| stagger           | number  | 0.05         | Delay between each item's animation in seconds.                                                             |
| animateFrom       | string  | "bottom"     | Direction from which items animate in. Options: 'top', 'bottom', 'left', 'right', 'center', 'random'.       |
| scaleOnHover      | boolean | true         | Whether items should scale on hover.                                                                        |
| hoverScale        | number  | 0.95         | Scale value when hovering over items (only applies if scaleOnHover is true).                                |
| blurToFocus       | boolean | true         | Whether items should animate from blurred to focused on initial load.                                       |
| colorShiftOnHover | boolean | false        | Whether to show a color overlay effect on hover.                                                            |

### Full Component Source

```jsx
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";

const useMedia = (queries, values, defaultValue) => {
  const get = () =>
    values[queries.findIndex((q) => matchMedia(q).matches)] ?? defaultValue;

  const [value, setValue] = useState(get);

  useEffect(() => {
    const handler = () => setValue(get);
    queries.forEach((q) => matchMedia(q).addEventListener("change", handler));
    return () =>
      queries.forEach((q) =>
        matchMedia(q).removeEventListener("change", handler),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queries]);

  return value;
};

const useMeasure = () => {
  const ref = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  return [ref, size];
};

const preloadImages = async (urls) => {
  await Promise.all(
    urls.map(
      (src) =>
        new Promise((resolve) => {
          const img = new Image();
          img.src = src;
          img.onload = img.onerror = () => resolve();
        }),
    ),
  );
};

const Masonry = ({
  items,
  ease = "power3.out",
  duration = 0.6,
  stagger = 0.05,
  animateFrom = "bottom",
  scaleOnHover = true,
  hoverScale = 0.95,
  blurToFocus = true,
  colorShiftOnHover = false,
}) => {
  const columns = useMedia(
    [
      "(min-width:1500px)",
      "(min-width:1000px)",
      "(min-width:600px)",
      "(min-width:400px)",
    ],
    [5, 4, 3, 2],
    1,
  );

  const [containerRef, { width }] = useMeasure();
  const [imagesReady, setImagesReady] = useState(false);

  const getInitialPosition = (item) => {
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return { x: item.x, y: item.y };

    let direction = animateFrom;
    if (animateFrom === "random") {
      const dirs = ["top", "bottom", "left", "right"];
      direction = dirs[Math.floor(Math.random() * dirs.length)];
    }

    switch (direction) {
      case "top":
        return { x: item.x, y: -200 };
      case "bottom":
        return { x: item.x, y: window.innerHeight + 200 };
      case "left":
        return { x: -200, y: item.y };
      case "right":
        return { x: window.innerWidth + 200, y: item.y };
      case "center":
        return {
          x: containerRect.width / 2 - item.w / 2,
          y: containerRect.height / 2 - item.h / 2,
        };
      default:
        return { x: item.x, y: item.y + 100 };
    }
  };

  useEffect(() => {
    preloadImages(items.map((i) => i.img)).then(() => setImagesReady(true));
  }, [items]);

  const grid = useMemo(() => {
    if (!width) return [];
    const colHeights = new Array(columns).fill(0);
    const gap = 16;
    const totalGaps = (columns - 1) * gap;
    const columnWidth = (width - totalGaps) / columns;

    return items.map((child) => {
      const col = colHeights.indexOf(Math.min(...colHeights));
      const x = col * (columnWidth + gap);
      const height = child.height / 2;
      const y = colHeights[col];

      colHeights[col] += height + gap;
      return { ...child, x, y, w: columnWidth, h: height };
    });
  }, [columns, items, width]);

  const hasMounted = useRef(false);

  useLayoutEffect(() => {
    if (!imagesReady) return;

    grid.forEach((item, index) => {
      const selector = `[data-key="${item.id}"]`;
      const animProps = { x: item.x, y: item.y, width: item.w, height: item.h };

      if (!hasMounted.current) {
        const start = getInitialPosition(item);
        gsap.fromTo(
          selector,
          {
            opacity: 0,
            x: start.x,
            y: start.y,
            width: item.w,
            height: item.h,
            ...(blurToFocus && { filter: "blur(10px)" }),
          },
          {
            opacity: 1,
            ...animProps,
            ...(blurToFocus && { filter: "blur(0px)" }),
            duration: 0.8,
            ease: "power3.out",
            delay: index * stagger,
          },
        );
      } else {
        gsap.to(selector, {
          ...animProps,
          duration,
          ease,
          overwrite: "auto",
        });
      }
    });

    hasMounted.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, imagesReady, stagger, animateFrom, blurToFocus, duration, ease]);

  const handleMouseEnter = (id, element) => {
    if (scaleOnHover) {
      gsap.to(`[data-key="${id}"]`, {
        scale: hoverScale,
        duration: 0.3,
        ease: "power2.out",
      });
    }
    if (colorShiftOnHover) {
      const overlay = element.querySelector(".color-overlay");
      if (overlay) gsap.to(overlay, { opacity: 0.3, duration: 0.3 });
    }
  };

  const handleMouseLeave = (id, element) => {
    if (scaleOnHover) {
      gsap.to(`[data-key="${id}"]`, {
        scale: 1,
        duration: 0.3,
        ease: "power2.out",
      });
    }
    if (colorShiftOnHover) {
      const overlay = element.querySelector(".color-overlay");
      if (overlay) gsap.to(overlay, { opacity: 0, duration: 0.3 });
    }
  };

  return (
    <div ref={containerRef} className="relative w-full h-full">
      {grid.map((item) => (
        <div
          key={item.id}
          data-key={item.id}
          className="absolute box-content"
          style={{ willChange: "transform, width, height, opacity" }}
          onClick={() => window.open(item.url, "_blank", "noopener")}
          onMouseEnter={(e) => handleMouseEnter(item.id, e.currentTarget)}
          onMouseLeave={(e) => handleMouseLeave(item.id, e.currentTarget)}
        >
          <div
            className="relative w-full h-full bg-cover bg-center rounded-[10px] shadow-[0px_10px_50px_-10px_rgba(0,0,0,0.2)] uppercase text-[10px] leading-[10px]"
            style={{ backgroundImage: `url(${item.img})` }}
          >
            {colorShiftOnHover && (
              <div className="color-overlay absolute inset-0 rounded-[10px] bg-gradient-to-tr from-pink-500/50 to-sky-500/50 opacity-0 pointer-events-none" />
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default Masonry;
```

### Integration Instructions

1. Install any listed dependencies.
2. Copy the component source into the appropriate directory in the project.
3. Import and render the component using the usage example above as a starting point.
4. Adjust props as needed for the specific use case — refer to the props table for all available options.

# ADDITIONAL PHOTO CARDS

## Integrate the <BounceCards /> component from React Bits

You are helping integrate an open-source React component into an existing application.

### Component: BounceCards

### Variant: JavaScript + Tailwind

### Dependencies: gsap

---

### Usage Example

```jsx
import BounceCards from "./BounceCards";

const images = [
  "https://picsum.photos/400/400?grayscale",
  "https://picsum.photos/500/500?grayscale",
  "https://picsum.photos/600/600?grayscale",
  "https://picsum.photos/700/700?grayscale",
  "https://picsum.photos/300/300?grayscale",
];

const transformStyles = [
  "rotate(5deg) translate(-150px)",
  "rotate(0deg) translate(-70px)",
  "rotate(-5deg)",
  "rotate(5deg) translate(70px)",
  "rotate(-5deg) translate(150px)",
];

<BounceCards
  className="custom-bounceCards"
  images={images}
  containerWidth={500}
  containerHeight={250}
  animationDelay={1}
  animationStagger={0.08}
  easeType="elastic.out(1, 0.5)"
  transformStyles={transformStyles}
  enableHover={false}
/>;
```

### Props

| Prop             | Type     | Default                        | Description                                                                       |
| ---------------- | -------- | ------------------------------ | --------------------------------------------------------------------------------- |
| className        | string   | —                              | Additional CSS classes for the container.                                         |
| images           | string[] | []                             | Array of image URLs to display.                                                   |
| containerWidth   | number   | 400                            | Width of the container (px).                                                      |
| containerHeight  | number   | 400                            | Height of the container (px).                                                     |
| animationDelay   | number   | 0.5                            | Delay (in seconds) before the animation starts.                                   |
| animationStagger | number   | 0.06                           | Time (in seconds) between each card's animation.                                  |
| easeType         | string   | elastic.out(1, 0.8)            | Easing function for the bounce.                                                   |
| transformStyles  | string[] | various rotations/translations | Custom transforms for each card position.                                         |
| enableHover      | boolean  | false                          | If true, hovering pushes siblings aside and flattens the hovered card's rotation. |

### Full Component Source

```jsx
import { useEffect, useRef } from "react";
import { gsap } from "gsap";

export default function BounceCards({
  className = "",
  images = [],
  containerWidth = 400,
  containerHeight = 400,
  animationDelay = 0.5,
  animationStagger = 0.06,
  easeType = "elastic.out(1, 0.8)",
  transformStyles = [
    "rotate(10deg) translate(-170px)",
    "rotate(5deg) translate(-85px)",
    "rotate(-3deg)",
    "rotate(-10deg) translate(85px)",
    "rotate(2deg) translate(170px)",
  ],
  enableHover = false,
}) {
  const containerRef = useRef(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        ".card",
        { scale: 0 },
        {
          scale: 1,
          stagger: animationStagger,
          ease: easeType,
          delay: animationDelay,
        },
      );
    }, containerRef);
    return () => ctx.revert();
  }, [animationStagger, easeType, animationDelay]);

  const getNoRotationTransform = (transformStr) => {
    const hasRotate = /rotate\([\s\S]*?\)/.test(transformStr);
    if (hasRotate) {
      return transformStr.replace(/rotate\([\s\S]*?\)/, "rotate(0deg)");
    } else if (transformStr === "none") {
      return "rotate(0deg)";
    } else {
      return `${transformStr} rotate(0deg)`;
    }
  };

  const getPushedTransform = (baseTransform, offsetX) => {
    const translateRegex = /translate\(([-0-9.]+)px\)/;
    const match = baseTransform.match(translateRegex);
    if (match) {
      const currentX = parseFloat(match[1]);
      const newX = currentX + offsetX;
      return baseTransform.replace(translateRegex, `translate(${newX}px)`);
    } else {
      return baseTransform === "none"
        ? `translate(${offsetX}px)`
        : `${baseTransform} translate(${offsetX}px)`;
    }
  };

  const pushSiblings = (hoveredIdx) => {
    if (!enableHover || !containerRef.current) return;

    const q = gsap.utils.selector(containerRef);
    images.forEach((_, i) => {
      const selector = q(`.card-${i}`);
      gsap.killTweensOf(selector);

      const baseTransform = transformStyles[i] || "none";

      if (i === hoveredIdx) {
        const noRotation = getNoRotationTransform(baseTransform);
        gsap.to(selector, {
          transform: noRotation,
          duration: 0.4,
          ease: "back.out(1.4)",
          overwrite: "auto",
        });
      } else {
        const offsetX = i < hoveredIdx ? -160 : 160;
        const pushedTransform = getPushedTransform(baseTransform, offsetX);

        const distance = Math.abs(hoveredIdx - i);
        const delay = distance * 0.05;

        gsap.to(selector, {
          transform: pushedTransform,
          duration: 0.4,
          ease: "back.out(1.4)",
          delay,
          overwrite: "auto",
        });
      }
    });
  };

  const resetSiblings = () => {
    if (!enableHover || !containerRef.current) return;
    const q = gsap.utils.selector(containerRef);
    images.forEach((_, i) => {
      const selector = q(`.card-${i}`);
      gsap.killTweensOf(selector);

      const baseTransform = transformStyles[i] || "none";
      gsap.to(selector, {
        transform: baseTransform,
        duration: 0.4,
        ease: "back.out(1.4)",
        overwrite: "auto",
      });
    });
  };

  return (
    <div
      className={`relative flex items-center justify-center ${className}`}
      style={{
        width: containerWidth,
        height: containerHeight,
      }}
      ref={containerRef}
    >
      {images.map((src, idx) => (
        <div
          key={idx}
          className={`card card-${idx} absolute w-[200px] aspect-square border-8 border-white rounded-[30px] overflow-hidden`}
          style={{
            boxShadow: "0 4px 10px rgba(0, 0, 0, 0.2)",
            transform: transformStyles[idx] || "none",
          }}
          onMouseEnter={() => pushSiblings(idx)}
          onMouseLeave={resetSiblings}
        >
          <img
            className="w-full h-full object-cover"
            src={src}
            alt={`card-${idx}`}
          />
        </div>
      ))}
    </div>
  );
}
```

### Integration Instructions

1. Install any listed dependencies.
2. Copy the component source into the appropriate directory in the project.
3. Import and render the component using the usage example above as a starting point.
4. Adjust props as needed for the specific use case — refer to the props table for all available options.

# ADDITIONAL STACKABLE CARD PHOTO -- DIFFERENT BECAUSE THE USER ACTUALLY HAS TO CLICK AND MOVE THE PHOTO

## Integrate the <Stack /> component from React Bits

You are helping integrate an open-source React component into an existing application.

### Component: Stack

### Variant: JavaScript + Tailwind

### Dependencies: motion

---

### Usage Example

```jsx
import Stack from "./Stack";

const images = [
  "https://images.unsplash.com/photo-1480074568708-e7b720bb3f09?q=80&w=500&auto=format",
  "https://images.unsplash.com/photo-1449844908441-8829872d2607?q=80&w=500&auto=format",
  "https://images.unsplash.com/photo-1452626212852-811d58933cae?q=80&w=500&auto=format",
  "https://images.unsplash.com/photo-1572120360610-d971b9d7767c?q=80&w=500&auto=format",
];

<div style={{ width: 208, height: 208 }}>
  <Stack
    randomRotation={true}
    sensitivity={180}
    sendToBackOnClick={true}
    cards={images.map((src, i) => (
      <img
        key={i}
        src={src}
        alt={`card-${i + 1}`}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    ))}
  />
</div>;
```

### Props

| Prop              | Type        | Default                         | Description                                                    |
| ----------------- | ----------- | ------------------------------- | -------------------------------------------------------------- |
| randomRotation    | boolean     | —                               | Applies a random rotation to each card for a 'messy' look.     |
| sensitivity       | number      | 200                             | Drag sensitivity for sending a card to the back.               |
| sendToBackOnClick | boolean     | false                           | When enabled, the stack also shifts to the next card on click. |
| cards             | ReactNode[] | []                              | The array of card elements to display in the stack.            |
| animationConfig   | object      | { stiffness: 260, damping: 20 } | Configures the spring animation's stiffness and damping.       |
| autoplay          | boolean     | false                           | When enabled, the stack automatically cycles through cards.    |
| autoplayDelay     | number      | 3000                            | Delay in milliseconds between automatic card transitions.      |
| pauseOnHover      | boolean     | false                           | When enabled, autoplay pauses when hovering over the stack.    |

### Full Component Source

```jsx
import { motion, useMotionValue, useTransform } from "motion/react";
import { useState, useEffect } from "react";

function CardRotate({
  children,
  onSendToBack,
  sensitivity,
  disableDrag = false,
}) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useTransform(y, [-100, 100], [60, -60]);
  const rotateY = useTransform(x, [-100, 100], [-60, 60]);

  function handleDragEnd(_, info) {
    if (
      Math.abs(info.offset.x) > sensitivity ||
      Math.abs(info.offset.y) > sensitivity
    ) {
      onSendToBack();
    } else {
      x.set(0);
      y.set(0);
    }
  }

  if (disableDrag) {
    return (
      <motion.div
        className="absolute inset-0 cursor-pointer"
        style={{ x: 0, y: 0 }}
      >
        {children}
      </motion.div>
    );
  }

  return (
    <motion.div
      className="absolute inset-0 cursor-grab"
      style={{ x, y, rotateX, rotateY }}
      drag
      dragConstraints={{ top: 0, right: 0, bottom: 0, left: 0 }}
      dragElastic={0.6}
      whileTap={{ cursor: "grabbing" }}
      onDragEnd={handleDragEnd}
    >
      {children}
    </motion.div>
  );
}

export default function Stack({
  randomRotation = false,
  sensitivity = 200,
  cards = [],
  animationConfig = { stiffness: 260, damping: 20 },
  sendToBackOnClick = false,
  autoplay = false,
  autoplayDelay = 3000,
  pauseOnHover = false,
  mobileClickOnly = false,
  mobileBreakpoint = 768,
}) {
  const [isMobile, setIsMobile] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < mobileBreakpoint);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, [mobileBreakpoint]);

  const shouldDisableDrag = mobileClickOnly && isMobile;
  const shouldEnableClick = sendToBackOnClick || shouldDisableDrag;

  const [stack, setStack] = useState(() => {
    if (cards.length) {
      return cards.map((content, index) => ({ id: index + 1, content }));
    } else {
      return [
        {
          id: 1,
          content: (
            <img
              src="https://images.unsplash.com/photo-1480074568708-e7b720bb3f09?q=80&w=500&auto=format"
              alt="card-1"
              className="w-full h-full object-cover pointer-events-none"
            />
          ),
        },
        {
          id: 2,
          content: (
            <img
              src="https://images.unsplash.com/photo-1449844908441-8829872d2607?q=80&w=500&auto=format"
              alt="card-2"
              className="w-full h-full object-cover pointer-events-none"
            />
          ),
        },
        {
          id: 3,
          content: (
            <img
              src="https://images.unsplash.com/photo-1452626212852-811d58933cae?q=80&w=500&auto=format"
              alt="card-3"
              className="w-full h-full object-cover pointer-events-none"
            />
          ),
        },
        {
          id: 4,
          content: (
            <img
              src="https://images.unsplash.com/photo-1572120360610-d971b9d7767c?q=80&w=500&auto=format"
              alt="card-4"
              className="w-full h-full object-cover pointer-events-none"
            />
          ),
        },
      ];
    }
  });

  useEffect(() => {
    if (cards.length) {
      setStack(cards.map((content, index) => ({ id: index + 1, content })));
    }
  }, [cards]);

  const sendToBack = (id) => {
    setStack((prev) => {
      const newStack = [...prev];
      const index = newStack.findIndex((card) => card.id === id);
      const [card] = newStack.splice(index, 1);
      newStack.unshift(card);
      return newStack;
    });
  };

  useEffect(() => {
    if (autoplay && stack.length > 1 && !isPaused) {
      const interval = setInterval(() => {
        const topCardId = stack[stack.length - 1].id;
        sendToBack(topCardId);
      }, autoplayDelay);

      return () => clearInterval(interval);
    }
  }, [autoplay, autoplayDelay, stack, isPaused]);

  return (
    <div
      className="relative w-full h-full"
      style={{
        perspective: 600,
      }}
      onMouseEnter={() => pauseOnHover && setIsPaused(true)}
      onMouseLeave={() => pauseOnHover && setIsPaused(false)}
    >
      {stack.map((card, index) => {
        const randomRotate = randomRotation ? Math.random() * 10 - 5 : 0;
        return (
          <CardRotate
            key={card.id}
            onSendToBack={() => sendToBack(card.id)}
            sensitivity={sensitivity}
            disableDrag={shouldDisableDrag}
          >
            <motion.div
              className="rounded-2xl overflow-hidden w-full h-full"
              onClick={() => shouldEnableClick && sendToBack(card.id)}
              animate={{
                rotateZ: (stack.length - index - 1) * 4 + randomRotate,
                scale: 1 + index * 0.06 - stack.length * 0.06,
                transformOrigin: "90% 90%",
              }}
              initial={false}
              transition={{
                type: "spring",
                stiffness: animationConfig.stiffness,
                damping: animationConfig.damping,
              }}
            >
              {card.content}
            </motion.div>
          </CardRotate>
        );
      })}
    </div>
  );
}
```

### Integration Instructions

1. Install any listed dependencies.
2. Copy the component source into the appropriate directory in the project.
3. Import and render the component using the usage example above as a starting point.
4. Adjust props as needed for the specific use case — refer to the props table for all available options.

# THIS IS ACTUALLY A MODEL VIEWER WHERE BY THE USER COULD BE EXPLORING 3D ELEMENTS THAT THEY MAY WANT TO PLACE IN THE ROOM PHOTO ON GEMINI NEXT TURN, ETC

## Integrate the <ModelViewer /> component from React Bits

You are helping integrate an open-source React component into an existing application.

### Component: ModelViewer

### Variant: JavaScript + Tailwind

### Dependencies: three @react-three/fiber @react-three/drei

---

### Usage Example

```jsx
import ModelViewer from "./ModelViewer";

<ModelViewer
  url="https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/SheenChair/glTF-Binary/SheenChair.glb"
  width={400}
  height={400}
/>;
```

### Props

| Prop                 | Type     | Default  | Description                                    |
| -------------------- | -------- | -------- | ---------------------------------------------- | ------------------------------ |
| url                  | string   | -        | URL of the 3D model file (glb/gltf/fbx/obj)    |
| width                | number   | string   | 400                                            | Width of the canvas container  |
| height               | number   | string   | 400                                            | Height of the canvas container |
| modelXOffset         | number   | 0        | Horizontal offset of the model                 |
| modelYOffset         | number   | 0        | Vertical offset of the model                   |
| defaultRotationX     | number   | -50      | Initial rotation on the X axis in degrees      |
| defaultRotationY     | number   | 20       | Initial rotation on the Y axis in degrees      |
| defaultZoom          | number   | 0.5      | Initial zoom distance factor                   |
| minZoomDistance      | number   | 0.5      | Minimum zoom distance                          |
| maxZoomDistance      | number   | 10       | Maximum zoom distance                          |
| enableMouseParallax  | boolean  | true     | Enable mouse-based parallax effect             |
| enableManualRotation | boolean  | true     | Enable manual rotation via drag                |
| enableHoverRotation  | boolean  | true     | Enable rotation on hover based on cursor       |
| enableManualZoom     | boolean  | true     | Enable manual zoom via mouse wheel or gestures |
| ambientIntensity     | number   | 0.3      | Intensity of ambient light                     |
| keyLightIntensity    | number   | 1        | Intensity of key light                         |
| fillLightIntensity   | number   | 0.5      | Intensity of fill light                        |
| rimLightIntensity    | number   | 0.8      | Intensity of rim light                         |
| environmentPreset    | string   | "forest" | Environment preset for scene lighting          |
| autoFrame            | boolean  | false    | Automatically frame the model in view          |
| fadeIn               | boolean  | false    | Enable fade-in transition on load              |
| autoRotate           | boolean  | false    | Enable automatic rotation animation            |
| autoRotateSpeed      | number   | 0.35     | Speed of automatic rotation                    |
| showScreenshotButton | boolean  | true     | Show the screenshot button overlay             |
| placeholderSrc       | string   | -        | Placeholder image source while loading         |
| onModelLoaded        | function | -        | Callback when model finishes loading           |

### Full Component Source

```jsx
/* eslint-disable react-hooks/rules-of-hooks */
/* eslint-disable react/no-unknown-property */
import { Suspense, useRef, useLayoutEffect, useEffect, useMemo } from "react";
import {
  Canvas,
  useFrame,
  useLoader,
  useThree,
  invalidate,
} from "@react-three/fiber";
import {
  OrbitControls,
  useGLTF,
  useFBX,
  useProgress,
  Html,
  Environment,
  ContactShadows,
} from "@react-three/drei";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader";
import * as THREE from "three";

const isTouch =
  typeof window !== "undefined" &&
  ("ontouchstart" in window || navigator.maxTouchPoints > 0);
const deg2rad = (d) => (d * Math.PI) / 180;
const DECIDE = 8;
const ROTATE_SPEED = 0.005;
const INERTIA = 0.925;
const PARALLAX_MAG = 0.05;
const PARALLAX_EASE = 0.12;
const HOVER_MAG = deg2rad(6);
const HOVER_EASE = 0.15;

const Loader = ({ placeholderSrc }) => {
  const { progress, active } = useProgress();
  if (!active && placeholderSrc) return null;
  return (
    <Html center>
      {placeholderSrc ? (
        <img
          src={placeholderSrc}
          width={128}
          height={128}
          className="blur-lg rounded-lg"
        />
      ) : (
        `${Math.round(progress)} %`
      )}
    </Html>
  );
};

const DesktopControls = ({ pivot, min, max, zoomEnabled }) => {
  const ref = useRef(null);
  useFrame(() => ref.current?.target.copy(pivot));
  return (
    <OrbitControls
      ref={ref}
      makeDefault
      enablePan={false}
      enableRotate={false}
      enableZoom={zoomEnabled}
      minDistance={min}
      maxDistance={max}
    />
  );
};

const ModelInner = ({
  url,
  xOff,
  yOff,
  pivot,
  initYaw,
  initPitch,
  minZoom,
  maxZoom,
  enableMouseParallax,
  enableManualRotation,
  enableHoverRotation,
  enableManualZoom,
  autoFrame,
  fadeIn,
  autoRotate,
  autoRotateSpeed,
  onLoaded,
}) => {
  const outer = useRef(null);
  const inner = useRef(null);
  const { camera, gl } = useThree();

  const vel = useRef({ x: 0, y: 0 });
  const tPar = useRef({ x: 0, y: 0 });
  const cPar = useRef({ x: 0, y: 0 });
  const tHov = useRef({ x: 0, y: 0 });
  const cHov = useRef({ x: 0, y: 0 });

  const ext = useMemo(() => url.split(".").pop().toLowerCase(), [url]);
  const content = useMemo(() => {
    if (ext === "glb" || ext === "gltf") return useGLTF(url).scene.clone();
    if (ext === "fbx") return useFBX(url).clone();
    if (ext === "obj") return useLoader(OBJLoader, url).clone();
    console.error("Unsupported format:", ext);
    return null;
  }, [url, ext]);

  const pivotW = useRef(new THREE.Vector3());
  useLayoutEffect(() => {
    if (!content) return;
    const g = inner.current;
    g.updateWorldMatrix(true, true);

    const sphere = new THREE.Box3()
      .setFromObject(g)
      .getBoundingSphere(new THREE.Sphere());
    const s = 1 / (sphere.radius * 2);
    g.position.set(-sphere.center.x, -sphere.center.y, -sphere.center.z);
    g.scale.setScalar(s);

    g.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        if (fadeIn) {
          o.material.transparent = true;
          o.material.opacity = 0;
        }
      }
    });

    g.getWorldPosition(pivotW.current);
    pivot.copy(pivotW.current);
    outer.current.rotation.set(initPitch, initYaw, 0);

    if (autoFrame && camera.isPerspectiveCamera) {
      const persp = camera;
      const fitR = sphere.radius * s;
      const d = (fitR * 1.2) / Math.sin((persp.fov * Math.PI) / 180 / 2);
      persp.position.set(
        pivotW.current.x,
        pivotW.current.y,
        pivotW.current.z + d,
      );
      persp.near = d / 10;
      persp.far = d * 10;
      persp.updateProjectionMatrix();
    }

    if (fadeIn) {
      let t = 0;
      const id = setInterval(() => {
        t += 0.05;
        const v = Math.min(t, 1);
        g.traverse((o) => {
          if (o.isMesh) o.material.opacity = v;
        });
        invalidate();
        if (v === 1) {
          clearInterval(id);
          onLoaded?.();
        }
      }, 16);
      return () => clearInterval(id);
    } else onLoaded?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  useEffect(() => {
    if (!enableManualRotation || isTouch) return;
    const el = gl.domElement;
    let drag = false;
    let lx = 0,
      ly = 0;
    const down = (e) => {
      if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      drag = true;
      lx = e.clientX;
      ly = e.clientY;
      window.addEventListener("pointerup", up);
    };
    const move = (e) => {
      if (!drag) return;
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      outer.current.rotation.y += dx * ROTATE_SPEED;
      outer.current.rotation.x += dy * ROTATE_SPEED;
      vel.current = { x: dx * ROTATE_SPEED, y: dy * ROTATE_SPEED };
      invalidate();
    };
    const up = () => (drag = false);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [gl, enableManualRotation]);

  useEffect(() => {
    if (!isTouch) return;
    const el = gl.domElement;
    const pts = new Map();

    let mode = "idle";
    let sx = 0,
      sy = 0,
      lx = 0,
      ly = 0,
      startDist = 0,
      startZ = 0;

    const down = (e) => {
      if (e.pointerType !== "touch") return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        mode = "decide";
        sx = lx = e.clientX;
        sy = ly = e.clientY;
      } else if (pts.size === 2 && enableManualZoom) {
        mode = "pinch";
        const [p1, p2] = [...pts.values()];
        startDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        startZ = camera.position.z;
        e.preventDefault();
      }
      invalidate();
    };

    const move = (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;

      if (mode === "decide") {
        const dx = e.clientX - sx;
        const dy = e.clientY - sy;
        if (Math.abs(dx) > DECIDE || Math.abs(dy) > DECIDE) {
          if (enableManualRotation && Math.abs(dx) > Math.abs(dy)) {
            mode = "rotate";
            el.setPointerCapture(e.pointerId);
          } else {
            mode = "idle";
            pts.clear();
          }
        }
      }

      if (mode === "rotate") {
        e.preventDefault();
        const dx = e.clientX - lx;
        const dy = e.clientY - ly;
        lx = e.clientX;
        ly = e.clientY;
        outer.current.rotation.y += dx * ROTATE_SPEED;
        outer.current.rotation.x += dy * ROTATE_SPEED;
        vel.current = { x: dx * ROTATE_SPEED, y: dy * ROTATE_SPEED };
        invalidate();
      } else if (mode === "pinch" && pts.size === 2) {
        e.preventDefault();
        const [p1, p2] = [...pts.values()];
        const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const ratio = startDist / d;
        camera.position.z = THREE.MathUtils.clamp(
          startZ * ratio,
          minZoom,
          maxZoom,
        );
        invalidate();
      }
    };

    const up = (e) => {
      pts.delete(e.pointerId);
      if (mode === "rotate" && pts.size === 0) mode = "idle";
      if (mode === "pinch" && pts.size < 2) mode = "idle";
    };

    el.addEventListener("pointerdown", down, { passive: true });
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up, { passive: true });
    window.addEventListener("pointercancel", up, { passive: true });
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, enableManualRotation, enableManualZoom, minZoom, maxZoom]);

  useEffect(() => {
    if (isTouch) return;
    const mm = (e) => {
      if (e.pointerType !== "mouse") return;
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      if (enableMouseParallax)
        tPar.current = { x: -nx * PARALLAX_MAG, y: -ny * PARALLAX_MAG };
      if (enableHoverRotation)
        tHov.current = { x: ny * HOVER_MAG, y: nx * HOVER_MAG };
      invalidate();
    };
    window.addEventListener("pointermove", mm);
    return () => window.removeEventListener("pointermove", mm);
  }, [enableMouseParallax, enableHoverRotation]);

  useFrame((_, dt) => {
    let need = false;
    cPar.current.x += (tPar.current.x - cPar.current.x) * PARALLAX_EASE;
    cPar.current.y += (tPar.current.y - cPar.current.y) * PARALLAX_EASE;
    const phx = cHov.current.x,
      phy = cHov.current.y;
    cHov.current.x += (tHov.current.x - cHov.current.x) * HOVER_EASE;
    cHov.current.y += (tHov.current.y - cHov.current.y) * HOVER_EASE;

    const ndc = pivotW.current.clone().project(camera);
    ndc.x += xOff + cPar.current.x;
    ndc.y += yOff + cPar.current.y;
    outer.current.position.copy(ndc.unproject(camera));

    outer.current.rotation.x += cHov.current.x - phx;
    outer.current.rotation.y += cHov.current.y - phy;

    if (autoRotate) {
      outer.current.rotation.y += autoRotateSpeed * dt;
      need = true;
    }

    outer.current.rotation.y += vel.current.x;
    outer.current.rotation.x += vel.current.y;
    vel.current.x *= INERTIA;
    vel.current.y *= INERTIA;
    if (Math.abs(vel.current.x) > 1e-4 || Math.abs(vel.current.y) > 1e-4)
      need = true;

    if (
      Math.abs(cPar.current.x - tPar.current.x) > 1e-4 ||
      Math.abs(cPar.current.y - tPar.current.y) > 1e-4 ||
      Math.abs(cHov.current.x - tHov.current.x) > 1e-4 ||
      Math.abs(cHov.current.y - tHov.current.y) > 1e-4
    )
      need = true;

    if (need) invalidate();
  });

  if (!content) return null;
  return (
    <group ref={outer}>
      <group ref={inner}>
        <primitive object={content} />
      </group>
    </group>
  );
};

const ModelViewer = ({
  url,
  width = 400,
  height = 400,
  modelXOffset = 0,
  modelYOffset = 0,
  defaultRotationX = -50,
  defaultRotationY = 20,
  defaultZoom = 0.5,
  minZoomDistance = 0.5,
  maxZoomDistance = 10,
  enableMouseParallax = true,
  enableManualRotation = true,
  enableHoverRotation = true,
  enableManualZoom = true,
  ambientIntensity = 0.3,
  keyLightIntensity = 1,
  fillLightIntensity = 0.5,
  rimLightIntensity = 0.8,
  environmentPreset = "forest",
  autoFrame = false,
  placeholderSrc,
  showScreenshotButton = true,
  fadeIn = false,
  autoRotate = false,
  autoRotateSpeed = 0.35,
  onModelLoaded,
}) => {
  useEffect(() => void useGLTF.preload(url), [url]);
  const pivot = useRef(new THREE.Vector3()).current;
  const contactRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);

  const initYaw = deg2rad(defaultRotationX);
  const initPitch = deg2rad(defaultRotationY);
  const camZ = Math.min(
    Math.max(defaultZoom, minZoomDistance),
    maxZoomDistance,
  );

  const capture = () => {
    const g = rendererRef.current,
      s = sceneRef.current,
      c = cameraRef.current;
    if (!g || !s || !c) return;
    g.shadowMap.enabled = false;
    const tmp = [];
    s.traverse((o) => {
      if (o.isLight && "castShadow" in o) {
        tmp.push({ l: o, cast: o.castShadow });
        o.castShadow = false;
      }
    });
    if (contactRef.current) contactRef.current.visible = false;
    g.render(s, c);
    const urlPNG = g.domElement.toDataURL("image/png");
    const a = document.createElement("a");
    a.download = "model.png";
    a.href = urlPNG;
    a.click();
    g.shadowMap.enabled = true;
    tmp.forEach(({ l, cast }) => (l.castShadow = cast));
    if (contactRef.current) contactRef.current.visible = true;
    invalidate();
  };

  return (
    <div
      style={{
        width,
        height,
        touchAction: "pan-y pinch-zoom",
      }}
      className="relative"
    >
      {showScreenshotButton && (
        <button
          onClick={capture}
          className="absolute top-4 right-4 z-10 cursor-pointer px-4 py-2 border border-white rounded-xl bg-transparent text-white hover:bg-white hover:text-black transition-colors"
        >
          Take Screenshot
        </button>
      )}

      <Canvas
        shadows
        frameloop="demand"
        gl={{ preserveDrawingBuffer: true }}
        onCreated={({ gl, scene, camera }) => {
          rendererRef.current = gl;
          sceneRef.current = scene;
          cameraRef.current = camera;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.outputColorSpace = THREE.SRGBColorSpace;
        }}
        camera={{ fov: 50, position: [0, 0, camZ], near: 0.01, far: 100 }}
        style={{ touchAction: "pan-y pinch-zoom" }}
      >
        {environmentPreset !== "none" && (
          <Environment preset={environmentPreset} background={false} />
        )}

        <ambientLight intensity={ambientIntensity} />
        <directionalLight
          position={[5, 5, 5]}
          intensity={keyLightIntensity}
          castShadow
        />
        <directionalLight
          position={[-5, 2, 5]}
          intensity={fillLightIntensity}
        />
        <directionalLight position={[0, 4, -5]} intensity={rimLightIntensity} />

        <ContactShadows
          ref={contactRef}
          position={[0, -0.5, 0]}
          opacity={0.35}
          scale={10}
          blur={2}
        />

        <Suspense fallback={<Loader placeholderSrc={placeholderSrc} />}>
          <ModelInner
            url={url}
            xOff={modelXOffset}
            yOff={modelYOffset}
            pivot={pivot}
            initYaw={initYaw}
            initPitch={initPitch}
            minZoom={minZoomDistance}
            maxZoom={maxZoomDistance}
            enableMouseParallax={enableMouseParallax}
            enableManualRotation={enableManualRotation}
            enableHoverRotation={enableHoverRotation}
            enableManualZoom={enableManualZoom}
            autoFrame={autoFrame}
            fadeIn={fadeIn}
            autoRotate={autoRotate}
            autoRotateSpeed={autoRotateSpeed}
            onLoaded={onModelLoaded}
          />
        </Suspense>

        {!isTouch && (
          <DesktopControls
            pivot={pivot}
            min={minZoomDistance}
            max={maxZoomDistance}
            zoomEnabled={enableManualZoom}
          />
        )}
      </Canvas>
    </div>
  );
};

export default ModelViewer;
```

### Integration Instructions

1. Install any listed dependencies.
2. Copy the component source into the appropriate directory in the project.
3. Import and render the component using the usage example above as a starting point.
4. Adjust props as needed for the specific use case — refer to the props table for all available options.

# ANOTHER GREAT WAY FOR THE USER TO LOOK FOR INSPIRATION PHOTOS TO PULL FROM THE "DRAWER" -- THIS WOULD REQUIRE INSPIRATION PHOTOS TO BE GROUPED TOGETHER BY TOPIC OR GRID SO THAT THE USER COULD SCROLL THROUGH THE LOGICAL GROUPINGS RATHER THAN JUST SCROLL AROUND ENDLESSLY WITH NO RYHME OR REASON

## Integrate the <DomeGallery /> component from React Bits

You are helping integrate an open-source React component into an existing application.

### Component: DomeGallery

### Variant: JavaScript + Tailwind

### Dependencies: @use-gesture/react

---

### Usage Example

```jsx
import DomeGallery from "./DomeGallery";
export default function App() {
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <DomeGallery />
    </div>
  );
}
```

### Props

| Prop                    | Type    | Default                          | Description                                                       |
| ----------------------- | ------- | -------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------- | ------ | ----------------------------------- |
| images                  | (string | { src: string; alt?: string })[] | DEFAULT_IMAGES                                                    | Array of image URLs (strings) or image objects with src and optional alt text |
| fit                     | number  | 0.5                              | Size factor for the dome radius based on container dimensions     |
| fitBasis                | 'auto'  | 'min'                            | 'max'                                                             | 'width'                                                                       | 'height' | 'auto' | Basis for calculating the dome size |
| minRadius               | number  | 600                              | Minimum radius for the dome in pixels                             |
| maxRadius               | number  | Infinity                         | Maximum radius for the dome in pixels                             |
| padFactor               | number  | 0.25                             | Padding factor for the viewer area                                |
| overlayBlurColor        | string  | '#120F17'                        | Color for the outer portion of the radial overlay blur            |
| maxVerticalRotationDeg  | number  | 5                                | Maximum vertical rotation angle in degrees                        |
| dragSensitivity         | number  | 20                               | Sensitivity of drag interactions                                  |
| enlargeTransitionMs     | number  | 300                              | Duration of image enlargement transition in milliseconds          |
| segments                | number  | 35                               | Number of segments for both X and Y to keep the dome proportional |
| dragDampening           | number  | 2                                | Damping factor for drag inertia (0-1, higher = more damping)      |
| openedImageWidth        | string  | '400px'                          | Width of the enlarged image                                       |
| openedImageHeight       | string  | '400px'                          | Height of the enlarged image                                      |
| imageBorderRadius       | string  | '30px'                           | Border radius for closed tile images                              |
| openedImageBorderRadius | string  | '30px'                           | Border radius for opened/enlarged images                          |
| grayscale               | boolean | true                             | Whether to render all images in grayscale                         |

### Full Component Source

```jsx
import { useEffect, useMemo, useRef, useCallback } from "react";
import { useGesture } from "@use-gesture/react";

const DEFAULT_IMAGES = [
  {
    src: "https://images.unsplash.com/photo-1755331039789-7e5680e26e8f?q=80&w=774&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
    alt: "Abstract art",
  },
  {
    src: "https://images.unsplash.com/photo-1755569309049-98410b94f66d?q=80&w=772&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
    alt: "Modern sculpture",
  },
  {
    src: "https://images.unsplash.com/photo-1755497595318-7e5e3523854f?q=80&w=774&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
    alt: "Digital artwork",
  },
  {
    src: "https://images.unsplash.com/photo-1755353985163-c2a0fe5ac3d8?q=80&w=774&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
    alt: "Contemporary art",
  },
  {
    src: "https://images.unsplash.com/photo-1745965976680-d00be7dc0377?q=80&w=774&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
    alt: "Geometric pattern",
  },
  {
    src: "https://images.unsplash.com/photo-1752588975228-21f44630bb3c?q=80&w=774&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
    alt: "Textured surface",
  },
  {
    src: "https://pbs.twimg.com/media/Gyla7NnXMAAXSo_?format=jpg&name=large",
    alt: "Social media image",
  },
];

const DEFAULTS = {
  maxVerticalRotationDeg: 5,
  dragSensitivity: 20,
  enlargeTransitionMs: 300,
  segments: 35,
};

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const normalizeAngle = (d) => ((d % 360) + 360) % 360;
const wrapAngleSigned = (deg) => {
  const a = (((deg + 180) % 360) + 360) % 360;
  return a - 180;
};
const getDataNumber = (el, name, fallback) => {
  const attr = el.dataset[name] ?? el.getAttribute(`data-${name}`);
  const n = attr == null ? NaN : parseFloat(attr);
  return Number.isFinite(n) ? n : fallback;
};

function buildItems(pool, seg) {
  const xCols = Array.from({ length: seg }, (_, i) => -37 + i * 2);
  const evenYs = [-4, -2, 0, 2, 4];
  const oddYs = [-3, -1, 1, 3, 5];

  const coords = xCols.flatMap((x, c) => {
    const ys = c % 2 === 0 ? evenYs : oddYs;
    return ys.map((y) => ({ x, y, sizeX: 2, sizeY: 2 }));
  });

  const totalSlots = coords.length;
  if (pool.length === 0) {
    return coords.map((c) => ({ ...c, src: "", alt: "" }));
  }
  if (pool.length > totalSlots) {
    console.warn(
      `[DomeGallery] Provided image count (${pool.length}) exceeds available tiles (${totalSlots}). Some images will not be shown.`,
    );
  }

  const normalizedImages = pool.map((image) => {
    if (typeof image === "string") {
      return { src: image, alt: "" };
    }
    return { src: image.src || "", alt: image.alt || "" };
  });

  const usedImages = Array.from(
    { length: totalSlots },
    (_, i) => normalizedImages[i % normalizedImages.length],
  );

  for (let i = 1; i < usedImages.length; i++) {
    if (usedImages[i].src === usedImages[i - 1].src) {
      for (let j = i + 1; j < usedImages.length; j++) {
        if (usedImages[j].src !== usedImages[i].src) {
          const tmp = usedImages[i];
          usedImages[i] = usedImages[j];
          usedImages[j] = tmp;
          break;
        }
      }
    }
  }

  return coords.map((c, i) => ({
    ...c,
    src: usedImages[i].src,
    alt: usedImages[i].alt,
  }));
}

function computeItemBaseRotation(offsetX, offsetY, sizeX, sizeY, segments) {
  const unit = 360 / segments / 2;
  const rotateY = unit * (offsetX + (sizeX - 1) / 2);
  const rotateX = unit * (offsetY - (sizeY - 1) / 2);
  return { rotateX, rotateY };
}

export default function DomeGallery({
  images = DEFAULT_IMAGES,
  fit = 0.5,
  fitBasis = "auto",
  minRadius = 600,
  maxRadius = Infinity,
  padFactor = 0.25,
  overlayBlurColor = "#120F17",
  maxVerticalRotationDeg = DEFAULTS.maxVerticalRotationDeg,
  dragSensitivity = DEFAULTS.dragSensitivity,
  enlargeTransitionMs = DEFAULTS.enlargeTransitionMs,
  segments = DEFAULTS.segments,
  dragDampening = 2,
  openedImageWidth = "400px",
  openedImageHeight = "400px",
  imageBorderRadius = "30px",
  openedImageBorderRadius = "30px",
  grayscale = true,
}) {
  const rootRef = useRef(null);
  const mainRef = useRef(null);
  const sphereRef = useRef(null);
  const frameRef = useRef(null);
  const viewerRef = useRef(null);
  const scrimRef = useRef(null);
  const focusedElRef = useRef(null);
  const originalTilePositionRef = useRef(null);

  const rotationRef = useRef({ x: 0, y: 0 });
  const startRotRef = useRef({ x: 0, y: 0 });
  const startPosRef = useRef(null);
  const draggingRef = useRef(false);
  const cancelTapRef = useRef(false);
  const movedRef = useRef(false);
  const inertiaRAF = useRef(null);
  const pointerTypeRef = useRef("mouse");
  const tapTargetRef = useRef(null);
  const openingRef = useRef(false);
  const openStartedAtRef = useRef(0);
  const lastDragEndAt = useRef(0);

  const scrollLockedRef = useRef(false);
  const lockScroll = useCallback(() => {
    if (scrollLockedRef.current) return;
    scrollLockedRef.current = true;
    document.body.classList.add("dg-scroll-lock");
  }, []);
  const unlockScroll = useCallback(() => {
    if (!scrollLockedRef.current) return;
    if (rootRef.current?.getAttribute("data-enlarging") === "true") return;
    scrollLockedRef.current = false;
    document.body.classList.remove("dg-scroll-lock");
  }, []);

  const items = useMemo(() => buildItems(images, segments), [images, segments]);

  const applyTransform = (xDeg, yDeg) => {
    const el = sphereRef.current;
    if (el) {
      el.style.transform = `translateZ(calc(var(--radius) * -1)) rotateX(${xDeg}deg) rotateY(${yDeg}deg)`;
    }
  };

  const lockedRadiusRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0].contentRect;
      const w = Math.max(1, cr.width),
        h = Math.max(1, cr.height);
      const minDim = Math.min(w, h),
        maxDim = Math.max(w, h),
        aspect = w / h;
      let basis;
      switch (fitBasis) {
        case "min":
          basis = minDim;
          break;
        case "max":
          basis = maxDim;
          break;
        case "width":
          basis = w;
          break;
        case "height":
          basis = h;
          break;
        default:
          basis = aspect >= 1.3 ? w : minDim;
      }
      let radius = basis * fit;
      const heightGuard = h * 1.35;
      radius = Math.min(radius, heightGuard);
      radius = clamp(radius, minRadius, maxRadius);
      lockedRadiusRef.current = Math.round(radius);

      const viewerPad = Math.max(8, Math.round(minDim * padFactor));
      root.style.setProperty("--radius", `${lockedRadiusRef.current}px`);
      root.style.setProperty("--viewer-pad", `${viewerPad}px`);
      root.style.setProperty("--overlay-blur-color", overlayBlurColor);
      root.style.setProperty("--tile-radius", imageBorderRadius);
      root.style.setProperty("--enlarge-radius", openedImageBorderRadius);
      root.style.setProperty(
        "--image-filter",
        grayscale ? "grayscale(1)" : "none",
      );
      applyTransform(rotationRef.current.x, rotationRef.current.y);

      const enlargedOverlay = viewerRef.current?.querySelector(".enlarge");
      if (enlargedOverlay && frameRef.current && mainRef.current) {
        const frameR = frameRef.current.getBoundingClientRect();
        const mainR = mainRef.current.getBoundingClientRect();

        const hasCustomSize = openedImageWidth && openedImageHeight;
        if (hasCustomSize) {
          const tempDiv = document.createElement("div");
          tempDiv.style.cssText = `position: absolute; width: ${openedImageWidth}; height: ${openedImageHeight}; visibility: hidden;`;
          document.body.appendChild(tempDiv);
          const tempRect = tempDiv.getBoundingClientRect();
          document.body.removeChild(tempDiv);

          const centeredLeft =
            frameR.left - mainR.left + (frameR.width - tempRect.width) / 2;
          const centeredTop =
            frameR.top - mainR.top + (frameR.height - tempRect.height) / 2;

          enlargedOverlay.style.left = `${centeredLeft}px`;
          enlargedOverlay.style.top = `${centeredTop}px`;
        } else {
          enlargedOverlay.style.left = `${frameR.left - mainR.left}px`;
          enlargedOverlay.style.top = `${frameR.top - mainR.top}px`;
          enlargedOverlay.style.width = `${frameR.width}px`;
          enlargedOverlay.style.height = `${frameR.height}px`;
        }
      }
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, [
    fit,
    fitBasis,
    minRadius,
    maxRadius,
    padFactor,
    overlayBlurColor,
    grayscale,
    imageBorderRadius,
    openedImageBorderRadius,
    openedImageWidth,
    openedImageHeight,
  ]);

  useEffect(() => {
    applyTransform(rotationRef.current.x, rotationRef.current.y);
  }, []);

  const stopInertia = useCallback(() => {
    if (inertiaRAF.current) {
      cancelAnimationFrame(inertiaRAF.current);
      inertiaRAF.current = null;
    }
  }, []);

  const startInertia = useCallback(
    (vx, vy) => {
      const MAX_V = 1.4;
      let vX = clamp(vx, -MAX_V, MAX_V) * 80;
      let vY = clamp(vy, -MAX_V, MAX_V) * 80;
      let frames = 0;
      const d = clamp(dragDampening ?? 0.6, 0, 1);
      const frictionMul = 0.94 + 0.055 * d;
      const stopThreshold = 0.015 - 0.01 * d;
      const maxFrames = Math.round(90 + 270 * d);
      const step = () => {
        vX *= frictionMul;
        vY *= frictionMul;
        if (Math.abs(vX) < stopThreshold && Math.abs(vY) < stopThreshold) {
          inertiaRAF.current = null;
          return;
        }
        if (++frames > maxFrames) {
          inertiaRAF.current = null;
          return;
        }
        const nextX = clamp(
          rotationRef.current.x - vY / 200,
          -maxVerticalRotationDeg,
          maxVerticalRotationDeg,
        );
        const nextY = wrapAngleSigned(rotationRef.current.y + vX / 200);
        rotationRef.current = { x: nextX, y: nextY };
        applyTransform(nextX, nextY);
        inertiaRAF.current = requestAnimationFrame(step);
      };
      stopInertia();
      inertiaRAF.current = requestAnimationFrame(step);
    },
    [dragDampening, maxVerticalRotationDeg, stopInertia],
  );

  useGesture(
    {
      onDragStart: ({ event }) => {
        if (focusedElRef.current) return;
        stopInertia();

        pointerTypeRef.current = event.pointerType || "mouse";
        if (pointerTypeRef.current === "touch") event.preventDefault();
        if (pointerTypeRef.current === "touch") lockScroll();
        draggingRef.current = true;
        cancelTapRef.current = false;
        movedRef.current = false;
        startRotRef.current = { ...rotationRef.current };
        startPosRef.current = { x: event.clientX, y: event.clientY };
        const potential = event.target.closest?.(".item__image");
        tapTargetRef.current = potential || null;
      },
      onDrag: ({
        event,
        last,
        velocity: velArr = [0, 0],
        direction: dirArr = [0, 0],
        movement,
      }) => {
        if (
          focusedElRef.current ||
          !draggingRef.current ||
          !startPosRef.current
        )
          return;

        if (pointerTypeRef.current === "touch") event.preventDefault();

        const dxTotal = event.clientX - startPosRef.current.x;
        const dyTotal = event.clientY - startPosRef.current.y;

        if (!movedRef.current) {
          const dist2 = dxTotal * dxTotal + dyTotal * dyTotal;
          if (dist2 > 16) movedRef.current = true;
        }

        const nextX = clamp(
          startRotRef.current.x - dyTotal / dragSensitivity,
          -maxVerticalRotationDeg,
          maxVerticalRotationDeg,
        );
        const nextY = startRotRef.current.y + dxTotal / dragSensitivity;

        const cur = rotationRef.current;
        if (cur.x !== nextX || cur.y !== nextY) {
          rotationRef.current = { x: nextX, y: nextY };
          applyTransform(nextX, nextY);
        }

        if (last) {
          draggingRef.current = false;
          let isTap = false;

          if (startPosRef.current) {
            const dx = event.clientX - startPosRef.current.x;
            const dy = event.clientY - startPosRef.current.y;
            const dist2 = dx * dx + dy * dy;
            const TAP_THRESH_PX = pointerTypeRef.current === "touch" ? 10 : 6;
            if (dist2 <= TAP_THRESH_PX * TAP_THRESH_PX) {
              isTap = true;
            }
          }

          let [vMagX, vMagY] = velArr;
          const [dirX, dirY] = dirArr;
          let vx = vMagX * dirX;
          let vy = vMagY * dirY;

          if (
            !isTap &&
            Math.abs(vx) < 0.001 &&
            Math.abs(vy) < 0.001 &&
            Array.isArray(movement)
          ) {
            const [mx, my] = movement;
            vx = (mx / dragSensitivity) * 0.02;
            vy = (my / dragSensitivity) * 0.02;
          }

          if (!isTap && (Math.abs(vx) > 0.005 || Math.abs(vy) > 0.005)) {
            startInertia(vx, vy);
          }
          startPosRef.current = null;
          cancelTapRef.current = !isTap;

          if (isTap && tapTargetRef.current && !focusedElRef.current) {
            openItemFromElement(tapTargetRef.current);
          }
          tapTargetRef.current = null;

          if (cancelTapRef.current)
            setTimeout(() => (cancelTapRef.current = false), 120);
          if (movedRef.current) lastDragEndAt.current = performance.now();
          movedRef.current = false;
          if (pointerTypeRef.current === "touch") unlockScroll();
        }
      },
    },
    { target: mainRef, eventOptions: { passive: false } },
  );

  useEffect(() => {
    const scrim = scrimRef.current;
    if (!scrim) return;

    const close = () => {
      if (performance.now() - openStartedAtRef.current < 250) return;
      const el = focusedElRef.current;
      if (!el) return;
      const parent = el.parentElement;
      const overlay = viewerRef.current?.querySelector(".enlarge");
      if (!overlay) return;

      const refDiv = parent.querySelector(".item__image--reference");

      const originalPos = originalTilePositionRef.current;
      if (!originalPos) {
        overlay.remove();
        if (refDiv) refDiv.remove();
        parent.style.setProperty("--rot-y-delta", `0deg`);
        parent.style.setProperty("--rot-x-delta", `0deg`);
        el.style.visibility = "";
        el.style.zIndex = 0;
        focusedElRef.current = null;
        rootRef.current?.removeAttribute("data-enlarging");
        openingRef.current = false;
        return;
      }

      const currentRect = overlay.getBoundingClientRect();
      const rootRect = rootRef.current.getBoundingClientRect();

      const originalPosRelativeToRoot = {
        left: originalPos.left - rootRect.left,
        top: originalPos.top - rootRect.top,
        width: originalPos.width,
        height: originalPos.height,
      };

      const overlayRelativeToRoot = {
        left: currentRect.left - rootRect.left,
        top: currentRect.top - rootRect.top,
        width: currentRect.width,
        height: currentRect.height,
      };

      const animatingOverlay = document.createElement("div");
      animatingOverlay.className = "enlarge-closing";
      animatingOverlay.style.cssText = `
        position: absolute;
        left: ${overlayRelativeToRoot.left}px;
        top: ${overlayRelativeToRoot.top}px;
        width: ${overlayRelativeToRoot.width}px;
        height: ${overlayRelativeToRoot.height}px;
        z-index: 9999;
        border-radius: ${openedImageBorderRadius};
        overflow: hidden;
        box-shadow: 0 10px 30px rgba(0,0,0,.35);
        transition: all ${enlargeTransitionMs}ms ease-out;
        pointer-events: none;
        margin: 0;
        transform: none;
        filter: ${grayscale ? "grayscale(1)" : "none"};
      `;

      const originalImg = overlay.querySelector("img");
      if (originalImg) {
        const img = originalImg.cloneNode();
        img.style.cssText = "width: 100%; height: 100%; object-fit: cover;";
        animatingOverlay.appendChild(img);
      }

      overlay.remove();
      rootRef.current.appendChild(animatingOverlay);

      void animatingOverlay.getBoundingClientRect();

      requestAnimationFrame(() => {
        animatingOverlay.style.left = originalPosRelativeToRoot.left + "px";
        animatingOverlay.style.top = originalPosRelativeToRoot.top + "px";
        animatingOverlay.style.width = originalPosRelativeToRoot.width + "px";
        animatingOverlay.style.height = originalPosRelativeToRoot.height + "px";
        animatingOverlay.style.opacity = "0";
      });

      const cleanup = () => {
        animatingOverlay.remove();
        originalTilePositionRef.current = null;

        if (refDiv) refDiv.remove();
        parent.style.transition = "none";
        el.style.transition = "none";

        parent.style.setProperty("--rot-y-delta", `0deg`);
        parent.style.setProperty("--rot-x-delta", `0deg`);

        requestAnimationFrame(() => {
          el.style.visibility = "";
          el.style.opacity = "0";
          el.style.zIndex = 0;
          focusedElRef.current = null;
          rootRef.current?.removeAttribute("data-enlarging");

          requestAnimationFrame(() => {
            parent.style.transition = "";
            el.style.transition = "opacity 300ms ease-out";

            requestAnimationFrame(() => {
              el.style.opacity = "1";
              setTimeout(() => {
                el.style.transition = "";
                el.style.opacity = "";
                openingRef.current = false;
                if (
                  !draggingRef.current &&
                  rootRef.current?.getAttribute("data-enlarging") !== "true"
                )
                  document.body.classList.remove("dg-scroll-lock");
              }, 300);
            });
          });
        });
      };

      animatingOverlay.addEventListener("transitionend", cleanup, {
        once: true,
      });
    };

    scrim.addEventListener("click", close);
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);

    return () => {
      scrim.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [enlargeTransitionMs, openedImageBorderRadius, grayscale]);

  const openItemFromElement = (el) => {
    if (openingRef.current) return;
    openingRef.current = true;
    openStartedAtRef.current = performance.now();
    lockScroll();
    const parent = el.parentElement;
    focusedElRef.current = el;
    el.setAttribute("data-focused", "true");

    const offsetX = getDataNumber(parent, "offsetX", 0);
    const offsetY = getDataNumber(parent, "offsetY", 0);
    const sizeX = getDataNumber(parent, "sizeX", 2);
    const sizeY = getDataNumber(parent, "sizeY", 2);

    const parentRot = computeItemBaseRotation(
      offsetX,
      offsetY,
      sizeX,
      sizeY,
      segments,
    );
    const parentY = normalizeAngle(parentRot.rotateY);
    const globalY = normalizeAngle(rotationRef.current.y);
    let rotY = -(parentY + globalY) % 360;
    if (rotY < -180) rotY += 360;
    const rotX = -parentRot.rotateX - rotationRef.current.x;

    parent.style.setProperty("--rot-y-delta", `${rotY}deg`);
    parent.style.setProperty("--rot-x-delta", `${rotX}deg`);

    const refDiv = document.createElement("div");
    refDiv.className = "item__image item__image--reference opacity-0";
    refDiv.style.transform = `rotateX(${-parentRot.rotateX}deg) rotateY(${-parentRot.rotateY}deg)`;
    parent.appendChild(refDiv);

    void refDiv.offsetHeight;

    const tileR = refDiv.getBoundingClientRect();
    const mainR = mainRef.current?.getBoundingClientRect();
    const frameR = frameRef.current?.getBoundingClientRect();

    if (!mainR || !frameR || tileR.width <= 0 || tileR.height <= 0) {
      openingRef.current = false;
      focusedElRef.current = null;
      parent.removeChild(refDiv);
      unlockScroll();
      return;
    }

    originalTilePositionRef.current = {
      left: tileR.left,
      top: tileR.top,
      width: tileR.width,
      height: tileR.height,
    };

    el.style.visibility = "hidden";
    el.style.zIndex = 0;

    const overlay = document.createElement("div");
    overlay.className = "enlarge";
    overlay.style.position = "absolute";
    overlay.style.left = frameR.left - mainR.left + "px";
    overlay.style.top = frameR.top - mainR.top + "px";
    overlay.style.width = frameR.width + "px";
    overlay.style.height = frameR.height + "px";
    overlay.style.opacity = "0";
    overlay.style.zIndex = "30";
    overlay.style.willChange = "transform, opacity";
    overlay.style.transformOrigin = "top left";
    overlay.style.transition = `transform ${enlargeTransitionMs}ms ease, opacity ${enlargeTransitionMs}ms ease`;
    overlay.style.borderRadius = openedImageBorderRadius;
    overlay.style.overflow = "hidden";
    overlay.style.boxShadow = "0 10px 30px rgba(0,0,0,.35)";

    const rawSrc = parent.dataset.src || el.querySelector("img")?.src || "";
    const rawAlt = parent.dataset.alt || el.querySelector("img")?.alt || "";
    const img = document.createElement("img");
    img.src = rawSrc;
    img.alt = rawAlt;
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "cover";
    img.style.filter = grayscale ? "grayscale(1)" : "none";
    overlay.appendChild(img);
    viewerRef.current.appendChild(overlay);

    const tx0 = tileR.left - frameR.left;
    const ty0 = tileR.top - frameR.top;
    const sx0 = tileR.width / frameR.width;
    const sy0 = tileR.height / frameR.height;

    const validSx0 = isFinite(sx0) && sx0 > 0 ? sx0 : 1;
    const validSy0 = isFinite(sy0) && sy0 > 0 ? sy0 : 1;

    overlay.style.transform = `translate(${tx0}px, ${ty0}px) scale(${validSx0}, ${validSy0})`;

    setTimeout(() => {
      if (!overlay.parentElement) return;
      overlay.style.opacity = "1";
      overlay.style.transform = "translate(0px, 0px) scale(1, 1)";
      rootRef.current?.setAttribute("data-enlarging", "true");
    }, 16);

    const wantsResize = openedImageWidth || openedImageHeight;
    if (wantsResize) {
      const onFirstEnd = (ev) => {
        if (ev.propertyName !== "transform") return;
        overlay.removeEventListener("transitionend", onFirstEnd);
        const prevTransition = overlay.style.transition;
        overlay.style.transition = "none";
        const tempWidth = openedImageWidth || `${frameR.width}px`;
        const tempHeight = openedImageHeight || `${frameR.height}px`;
        overlay.style.width = tempWidth;
        overlay.style.height = tempHeight;
        const newRect = overlay.getBoundingClientRect();
        overlay.style.width = frameR.width + "px";
        overlay.style.height = frameR.height + "px";
        void overlay.offsetWidth;
        overlay.style.transition = `left ${enlargeTransitionMs}ms ease, top ${enlargeTransitionMs}ms ease, width ${enlargeTransitionMs}ms ease, height ${enlargeTransitionMs}ms ease`;
        const centeredLeft =
          frameR.left - mainR.left + (frameR.width - newRect.width) / 2;
        const centeredTop =
          frameR.top - mainR.top + (frameR.height - newRect.height) / 2;
        requestAnimationFrame(() => {
          overlay.style.left = `${centeredLeft}px`;
          overlay.style.top = `${centeredTop}px`;
          overlay.style.width = tempWidth;
          overlay.style.height = tempHeight;
        });
        const cleanupSecond = () => {
          overlay.removeEventListener("transitionend", cleanupSecond);
          overlay.style.transition = prevTransition;
        };
        overlay.addEventListener("transitionend", cleanupSecond, {
          once: true,
        });
      };
      overlay.addEventListener("transitionend", onFirstEnd);
    }
  };

  useEffect(() => {
    return () => {
      document.body.classList.remove("dg-scroll-lock");
    };
  }, []);

  const cssStyles = `
    .sphere-root {
      --radius: 520px;
      --viewer-pad: 72px;
      --circ: calc(var(--radius) * 3.14);
      --rot-y: calc((360deg / var(--segments-x)) / 2);
      --rot-x: calc((360deg / var(--segments-y)) / 2);
      --item-width: calc(var(--circ) / var(--segments-x));
      --item-height: calc(var(--circ) / var(--segments-y));
    }
    
    .sphere-root * {
      box-sizing: border-box;
    }
    .sphere, .sphere-item, .item__image { transform-style: preserve-3d; }
    
    .stage {
      width: 100%;
      height: 100%;
      display: grid;
      place-items: center;
      position: absolute;
      inset: 0;
      margin: auto;
      perspective: calc(var(--radius) * 2);
      perspective-origin: 50% 50%;
    }
    
    .sphere {
      transform: translateZ(calc(var(--radius) * -1));
      will-change: transform;
      position: absolute;
    }
    
    .sphere-item {
      width: calc(var(--item-width) * var(--item-size-x));
      height: calc(var(--item-height) * var(--item-size-y));
      position: absolute;
      top: -999px;
      bottom: -999px;
      left: -999px;
      right: -999px;
      margin: auto;
      transform-origin: 50% 50%;
      backface-visibility: hidden;
      transition: transform 300ms;
      transform: rotateY(calc(var(--rot-y) * (var(--offset-x) + ((var(--item-size-x) - 1) / 2)) + var(--rot-y-delta, 0deg))) 
                 rotateX(calc(var(--rot-x) * (var(--offset-y) - ((var(--item-size-y) - 1) / 2)) + var(--rot-x-delta, 0deg))) 
                 translateZ(var(--radius));
    }
    
    .sphere-root[data-enlarging="true"] .scrim {
      opacity: 1 !important;
      pointer-events: all !important;
    }
    
    @media (max-aspect-ratio: 1/1) {
      .viewer-frame {
        height: auto !important;
        width: 100% !important;
      }
    }
    
    // body.dg-scroll-lock {
    //   position: fixed !important;
    //   top: 0;
    //   left: 0;
    //   width: 100% !important;
    //   height: 100% !important;
    //   overflow: hidden !important;
    //   touch-action: none !important;
    //   overscroll-behavior: contain !important;
    // }
    .item__image {
      position: absolute;
      inset: 10px;
      border-radius: var(--tile-radius, 12px);
      overflow: hidden;
      cursor: pointer;
      backface-visibility: hidden;
      -webkit-backface-visibility: hidden;
      transition: transform 300ms;
      pointer-events: auto;
      -webkit-transform: translateZ(0);
      transform: translateZ(0);
    }
    .item__image--reference {
      position: absolute;
      inset: 10px;
      pointer-events: none;
    }
  `;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: cssStyles }} />
      <div
        ref={rootRef}
        className="sphere-root relative w-full h-full"
        style={{
          ["--segments-x"]: segments,
          ["--segments-y"]: segments,
          ["--overlay-blur-color"]: overlayBlurColor,
          ["--tile-radius"]: imageBorderRadius,
          ["--enlarge-radius"]: openedImageBorderRadius,
          ["--image-filter"]: grayscale ? "grayscale(1)" : "none",
        }}
      >
        <main
          ref={mainRef}
          className="absolute inset-0 grid place-items-center overflow-hidden select-none bg-transparent"
          style={{
            touchAction: "none",
            WebkitUserSelect: "none",
          }}
        >
          <div className="stage">
            <div ref={sphereRef} className="sphere">
              {items.map((it, i) => (
                <div
                  key={`${it.x},${it.y},${i}`}
                  className="sphere-item absolute m-auto"
                  data-src={it.src}
                  data-alt={it.alt}
                  data-offset-x={it.x}
                  data-offset-y={it.y}
                  data-size-x={it.sizeX}
                  data-size-y={it.sizeY}
                  style={{
                    ["--offset-x"]: it.x,
                    ["--offset-y"]: it.y,
                    ["--item-size-x"]: it.sizeX,
                    ["--item-size-y"]: it.sizeY,
                    top: "-999px",
                    bottom: "-999px",
                    left: "-999px",
                    right: "-999px",
                  }}
                >
                  <div
                    className="item__image absolute block overflow-hidden cursor-pointer bg-gray-200 transition-transform duration-300"
                    role="button"
                    tabIndex={0}
                    aria-label={it.alt || "Open image"}
                    onClick={(e) => {
                      if (draggingRef.current) return;
                      if (movedRef.current) return;
                      if (performance.now() - lastDragEndAt.current < 80)
                        return;
                      if (openingRef.current) return;
                      openItemFromElement(e.currentTarget);
                    }}
                    onPointerUp={(e) => {
                      if (e.pointerType !== "touch") return;
                      if (draggingRef.current) return;
                      if (movedRef.current) return;
                      if (performance.now() - lastDragEndAt.current < 80)
                        return;
                      if (openingRef.current) return;
                      openItemFromElement(e.currentTarget);
                    }}
                    style={{
                      inset: "10px",
                      borderRadius: `var(--tile-radius, ${imageBorderRadius})`,
                      backfaceVisibility: "hidden",
                    }}
                  >
                    <img
                      src={it.src}
                      draggable={false}
                      alt={it.alt}
                      className="w-full h-full object-cover pointer-events-none"
                      style={{
                        backfaceVisibility: "hidden",
                        filter: `var(--image-filter, ${grayscale ? "grayscale(1)" : "none"})`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div
            className="absolute inset-0 m-auto z-[3] pointer-events-none"
            style={{
              backgroundImage: `radial-gradient(rgba(235, 235, 235, 0) 65%, var(--overlay-blur-color, ${overlayBlurColor}) 100%)`,
            }}
          />

          <div
            className="absolute inset-0 m-auto z-[3] pointer-events-none"
            style={{
              WebkitMaskImage: `radial-gradient(rgba(235, 235, 235, 0) 70%, var(--overlay-blur-color, ${overlayBlurColor}) 90%)`,
              maskImage: `radial-gradient(rgba(235, 235, 235, 0) 70%, var(--overlay-blur-color, ${overlayBlurColor}) 90%)`,
              backdropFilter: "blur(3px)",
            }}
          />

          <div
            className="absolute left-0 right-0 top-0 h-[120px] z-[5] pointer-events-none rotate-180"
            style={{
              background: `linear-gradient(to bottom, transparent, var(--overlay-blur-color, ${overlayBlurColor}))`,
            }}
          />
          <div
            className="absolute left-0 right-0 bottom-0 h-[120px] z-[5] pointer-events-none"
            style={{
              background: `linear-gradient(to bottom, transparent, var(--overlay-blur-color, ${overlayBlurColor}))`,
            }}
          />

          <div
            ref={viewerRef}
            className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center"
            style={{ padding: "var(--viewer-pad)" }}
          >
            <div
              ref={scrimRef}
              className="scrim absolute inset-0 z-10 pointer-events-none opacity-0 transition-opacity duration-500"
              style={{
                background: "rgba(0, 0, 0, 0.4)",
                backdropFilter: "blur(3px)",
              }}
            />
            <div
              ref={frameRef}
              className="viewer-frame h-full aspect-square flex"
              style={{
                borderRadius: `var(--enlarge-radius, ${openedImageBorderRadius})`,
              }}
            />
          </div>
        </main>
      </div>
    </>
  );
}
```

### Integration Instructions

1. Install any listed dependencies.
2. Copy the component source into the appropriate directory in the project.
3. Import and render the component using the usage example above as a starting point.
4. Adjust props as needed for the specific use case — refer to the props table for all available options.

# HERE ARE SOME ADDITIONAL COMPOENTS TO KEEP THE USER ENTERTAINED WHY GEMINI IS BUSY WITH WHATEVER TASK IT WAS GIVEN

# LASER FLOW

## Integrate the <LaserFlow /> component from React Bits

You are helping integrate an open-source React component into an existing application.

### Component: LaserFlow

### Variant: JavaScript + Tailwind

### Dependencies: three

---

### Usage Example

```jsx
import LaserFlow from "./LaserFlow";
import { useRef } from "react";

// NOTE: You can also adjust the variables in the shader for super detailed customization

// Basic Usage
<div style={{ height: "500px", position: "relative", overflow: "hidden" }}>
  <LaserFlow />
</div>;

// Image Example Interactive Reveal Effect
function LaserFlowBoxExample() {
  const revealImgRef = useRef(null);

  return (
    <div
      style={{
        height: "800px",
        position: "relative",
        overflow: "hidden",
        backgroundColor: "#120F17",
      }}
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const el = revealImgRef.current;
        if (el) {
          el.style.setProperty("--mx", `${x}px`);
          el.style.setProperty("--my", `${y + rect.height * 0.5}px`);
        }
      }}
      onMouseLeave={() => {
        const el = revealImgRef.current;
        if (el) {
          el.style.setProperty("--mx", "-9999px");
          el.style.setProperty("--my", "-9999px");
        }
      }}
    >
      <LaserFlow
        horizontalBeamOffset={0.1}
        verticalBeamOffset={0.0}
        color="#FF79C6"
      />

      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "86%",
          height: "60%",
          backgroundColor: "#120F17",
          borderRadius: "20px",
          border: "2px solid #FF79C6",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontSize: "2rem",
          zIndex: 6,
        }}
      >
        {/* Your content here */}
      </div>

      <img
        ref={revealImgRef}
        src="/path/to/image.jpg"
        alt="Reveal effect"
        style={{
          position: "absolute",
          width: "100%",
          top: "-50%",
          zIndex: 5,
          mixBlendMode: "lighten",
          opacity: 0.3,
          pointerEvents: "none",
          "--mx": "-9999px",
          "--my": "-9999px",
          WebkitMaskImage:
            "radial-gradient(circle at var(--mx) var(--my), rgba(255,255,255,1) 0px, rgba(255,255,255,0.95) 60px, rgba(255,255,255,0.6) 120px, rgba(255,255,255,0.25) 180px, rgba(255,255,255,0) 240px)",
          maskImage:
            "radial-gradient(circle at var(--mx) var(--my), rgba(255,255,255,1) 0px, rgba(255,255,255,0.95) 60px, rgba(255,255,255,0.6) 120px, rgba(255,255,255,0.25) 180px, rgba(255,255,255,0) 240px)",
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
        }}
        wispDensity={2.8}
        wispSpeed={16.5}
        flowSpeed={0.64}
        flowStrength={0.43}
        fogIntensity={1}
        fogScale={0.39}
        falloffStart={1.63}
      />
    </div>
  );
}
```

### Props

| Prop                 | Type   | Default | Description                                                        |
| -------------------- | ------ | ------- | ------------------------------------------------------------------ |
| horizontalBeamOffset | number | 0.1     | Horizontal offset of the beam (0–1 of canvas width).               |
| verticalBeamOffset   | number | 0.0     | Vertical offset of the beam (0–1 of canvas height).                |
| horizontalSizing     | number | 0.5     | Horizontal sizing factor of the beam footprint.                    |
| verticalSizing       | number | 2.0     | Vertical sizing factor of the beam footprint.                      |
| wispDensity          | number | 1       | Density of micro-streak wisps.                                     |
| wispSpeed            | number | 15.0    | Speed of wisp motion.                                              |
| wispIntensity        | number | 5.0     | Brightness of wisps.                                               |
| flowSpeed            | number | 0.35    | Speed of the beam’s flow modulation.                               |
| flowStrength         | number | 0.25    | Strength of the beam’s flow modulation.                            |
| fogIntensity         | number | 0.45    | Overall volumetric fog intensity.                                  |
| fogScale             | number | 0.3     | Spatial scale for the fog noise.                                   |
| fogFallSpeed         | number | 0.6     | Drift speed for the fog field.                                     |
| mouseTiltStrength    | number | 0.01    | How much mouse x tilts the fog volume.                             |
| mouseSmoothTime      | number | 0.0     | Pointer smoothing time (seconds).                                  |
| decay                | number | 1.1     | Beam decay shaping for sampling envelope.                          |
| falloffStart         | number | 1.2     | Falloff start radius used in inverse-square blending.              |
| dpr                  | number | auto    | Device pixel ratio override (defaults to window.devicePixelRatio). |
| color                | string | #FF79C6 | Beam color (hex).                                                  |

### Full Component Source

```jsx
import { useEffect, useRef } from "react";
import * as THREE from "three";

const VERT = `
precision highp float;
attribute vec3 position;
void main(){
  gl_Position = vec4(position, 1.0);
}
`;

const FRAG = `
#ifdef GL_ES
#extension GL_OES_standard_derivatives : enable
#endif
precision highp float;
precision mediump int;

uniform float iTime;
uniform vec3 iResolution;
uniform vec4 iMouse;
uniform float uWispDensity;
uniform float uTiltScale;
uniform float uFlowTime;
uniform float uFogTime;
uniform float uBeamXFrac;
uniform float uBeamYFrac;
uniform float uFlowSpeed;
uniform float uVLenFactor;
uniform float uHLenFactor;
uniform float uFogIntensity;
uniform float uFogScale;
uniform float uWSpeed;
uniform float uWIntensity;
uniform float uFlowStrength;
uniform float uDecay;
uniform float uFalloffStart;
uniform float uFogFallSpeed;
uniform vec3 uColor;
uniform float uFade;

// Core beam/flare shaping and dynamics
#define PI 3.14159265359
#define TWO_PI 6.28318530718
#define EPS 1e-6
#define EDGE_SOFT (DT_LOCAL*4.0)
#define DT_LOCAL 0.0038
#define TAP_RADIUS 6
#define R_H 150.0
#define R_V 150.0
#define FLARE_HEIGHT 16.0
#define FLARE_AMOUNT 8.0
#define FLARE_EXP 2.0
#define TOP_FADE_START 0.1
#define TOP_FADE_EXP 1.0
#define FLOW_PERIOD 0.5
#define FLOW_SHARPNESS 1.5

// Wisps (animated micro-streaks) that travel along the beam
#define W_BASE_X 1.5
#define W_LAYER_GAP 0.25
#define W_LANES 10
#define W_SIDE_DECAY 0.5
#define W_HALF 0.01
#define W_AA 0.15
#define W_CELL 20.0
#define W_SEG_MIN 0.01
#define W_SEG_MAX 0.55
#define W_CURVE_AMOUNT 15.0
#define W_CURVE_RANGE (FLARE_HEIGHT - 3.0)
#define W_BOTTOM_EXP 10.0

// Volumetric fog controls
#define FOG_ON 1
#define FOG_CONTRAST 1.2
#define FOG_SPEED_U 0.1
#define FOG_SPEED_V -0.1
#define FOG_OCTAVES 5
#define FOG_BOTTOM_BIAS 0.8
#define FOG_TILT_TO_MOUSE 0.05
#define FOG_TILT_DEADZONE 0.01
#define FOG_TILT_MAX_X 0.35
#define FOG_TILT_SHAPE 1.5
#define FOG_BEAM_MIN 0.0
#define FOG_BEAM_MAX 0.75
#define FOG_MASK_GAMMA 0.5
#define FOG_EXPAND_SHAPE 12.2
#define FOG_EDGE_MIX 0.5

// Horizontal vignette for the fog volume
#define HFOG_EDGE_START 0.20
#define HFOG_EDGE_END 0.98
#define HFOG_EDGE_GAMMA 1.4
#define HFOG_Y_RADIUS 25.0
#define HFOG_Y_SOFT 60.0

// Beam extents and edge masking
#define EDGE_X0 0.22
#define EDGE_X1 0.995
#define EDGE_X_GAMMA 1.25
#define EDGE_LUMA_T0 0.0
#define EDGE_LUMA_T1 2.0
#define DITHER_STRENGTH 1.0

    float g(float x){return x<=0.00031308?12.92*x:1.055*pow(x,1.0/2.4)-0.055;}
    float bs(vec2 p,vec2 q,float powr){
        float d=distance(p,q),f=powr*uFalloffStart,r=(f*f)/(d*d+EPS);
        return powr*min(1.0,r);
    }
    float bsa(vec2 p,vec2 q,float powr,vec2 s){
        vec2 d=p-q; float dd=(d.x*d.x)/(s.x*s.x)+(d.y*d.y)/(s.y*s.y),f=powr*uFalloffStart,r=(f*f)/(dd+EPS);
        return powr*min(1.0,r);
    }
    float tri01(float x){float f=fract(x);return 1.0-abs(f*2.0-1.0);}
    float tauWf(float t,float tmin,float tmax){float a=smoothstep(tmin,tmin+EDGE_SOFT,t),b=1.0-smoothstep(tmax-EDGE_SOFT,tmax,t);return max(0.0,a*b);} 
    float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+34.123);return fract(p.x*p.y);}
    float vnoise(vec2 p){
        vec2 i=floor(p),f=fract(p);
        float a=h21(i),b=h21(i+vec2(1,0)),c=h21(i+vec2(0,1)),d=h21(i+vec2(1,1));
        vec2 u=f*f*(3.0-2.0*f);
        return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
    }
    float fbm2(vec2 p){
        float v=0.0,amp=0.6; mat2 m=mat2(0.86,0.5,-0.5,0.86);
        for(int i=0;i<FOG_OCTAVES;++i){v+=amp*vnoise(p); p=m*p*2.03+17.1; amp*=0.52;}
        return v;
    }
    float rGate(float x,float l){float a=smoothstep(0.0,W_AA,x),b=1.0-smoothstep(l,l+W_AA,x);return max(0.0,a*b);}
    float flareY(float y){float t=clamp(1.0-(clamp(y,0.0,FLARE_HEIGHT)/max(FLARE_HEIGHT,EPS)),0.0,1.0);return pow(t,FLARE_EXP);}

    float vWisps(vec2 uv,float topF){
    float y=uv.y,yf=(y+uFlowTime*uWSpeed)/W_CELL;
    float dRaw=clamp(uWispDensity,0.0,2.0),d=dRaw<=0.0?1.0:dRaw;
    float lanesF=floor(float(W_LANES)*min(d,1.0)+0.5); // WebGL1-safe
    int lanes=int(max(1.0,lanesF));
    float sp=min(d,1.0),ep=max(d-1.0,0.0);
    float fm=flareY(max(y,0.0)),rm=clamp(1.0-(y/max(W_CURVE_RANGE,EPS)),0.0,1.0),cm=fm*rm;
    const float G=0.05; float xS=1.0+(FLARE_AMOUNT*W_CURVE_AMOUNT*G)*cm;
    float sPix=clamp(y/R_V,0.0,1.0),bGain=pow(1.0-sPix,W_BOTTOM_EXP),sum=0.0;
    for(int s=0;s<2;++s){
        float sgn=s==0?-1.0:1.0;
        for(int i=0;i<W_LANES;++i){
            if(i>=lanes) break;
            float off=W_BASE_X+float(i)*W_LAYER_GAP,xc=sgn*(off*xS);
            float dx=abs(uv.x-xc),lat=1.0-smoothstep(W_HALF,W_HALF+W_AA,dx),amp=exp(-off*W_SIDE_DECAY);
            float seed=h21(vec2(off,sgn*17.0)),yf2=yf+seed*7.0,ci=floor(yf2),fy=fract(yf2);
            float seg=mix(W_SEG_MIN,W_SEG_MAX,h21(vec2(ci,off*2.3)));
            float spR=h21(vec2(ci,off+sgn*31.0)),seg1=rGate(fy,seg)*step(spR,sp);
            if(ep>0.0){float spR2=h21(vec2(ci*3.1+7.0,off*5.3+sgn*13.0)); float f2=fract(fy+0.5); seg1+=rGate(f2,seg*0.9)*step(spR2,ep);}
            sum+=amp*lat*seg1;
        }
    }
    float span=smoothstep(-3.0,0.0,y)*(1.0-smoothstep(R_V-6.0,R_V,y));
    return uWIntensity*sum*topF*bGain*span;
}

void mainImage(out vec4 fc,in vec2 frag){
    vec2 C=iResolution.xy*.5; float invW=1.0/max(C.x,1.0);
    vec2 sc=(512.0/iResolution.xy)*.4;
    vec2 uv=(frag-C)*sc,off=vec2(uBeamXFrac*iResolution.x*sc.x,uBeamYFrac*iResolution.y*sc.y);
    vec2 uvc = uv - off;
    float a=0.0,b=0.0;
    float basePhase=1.5*PI+uDecay*.5; float tauMin=basePhase-uDecay; float tauMax=basePhase;
    float cx=clamp(uvc.x/(R_H*uHLenFactor),-1.0,1.0),tH=clamp(TWO_PI-acos(cx),tauMin,tauMax);
    for(int k=-TAP_RADIUS;k<=TAP_RADIUS;++k){
        float tu=tH+float(k)*DT_LOCAL,wt=tauWf(tu,tauMin,tauMax); if(wt<=0.0) continue;
        float spd=max(abs(sin(tu)),0.02),u=clamp((basePhase-tu)/max(uDecay,EPS),0.0,1.0),env=pow(1.0-abs(u*2.0-1.0),0.8);
        vec2 p=vec2((R_H*uHLenFactor)*cos(tu),0.0);
        a+=wt*bs(uvc,p,env*spd);
    }
    float yPix=uvc.y,cy=clamp(-yPix/(R_V*uVLenFactor),-1.0,1.0),tV=clamp(TWO_PI-acos(cy),tauMin,tauMax);
    for(int k=-TAP_RADIUS;k<=TAP_RADIUS;++k){
        float tu=tV+float(k)*DT_LOCAL,wt=tauWf(tu,tauMin,tauMax); if(wt<=0.0) continue;
        float yb=(-R_V)*cos(tu),s=clamp(yb/R_V,0.0,1.0),spd=max(abs(sin(tu)),0.02);
        float env=pow(1.0-s,0.6)*spd;
        float cap=1.0-smoothstep(TOP_FADE_START,1.0,s); cap=pow(cap,TOP_FADE_EXP); env*=cap;
        float ph=s/max(FLOW_PERIOD,EPS)+uFlowTime*uFlowSpeed;
        float fl=pow(tri01(ph),FLOW_SHARPNESS);
        env*=mix(1.0-uFlowStrength,1.0,fl);
        float yp=(-R_V*uVLenFactor)*cos(tu),m=pow(smoothstep(FLARE_HEIGHT,0.0,yp),FLARE_EXP),wx=1.0+FLARE_AMOUNT*m;
        vec2 sig=vec2(wx,1.0),p=vec2(0.0,yp);
        float mask=step(0.0,yp);
        b+=wt*bsa(uvc,p,mask*env,sig);
    }
    float sPix=clamp(yPix/R_V,0.0,1.0),topA=pow(1.0-smoothstep(TOP_FADE_START,1.0,sPix),TOP_FADE_EXP);
    float L=a+b*topA;
    float w=vWisps(vec2(uvc.x,yPix),topA);
    float fog=0.0;
#if FOG_ON
    vec2 fuv=uvc*uFogScale;
    float mAct=step(1.0,length(iMouse.xy)),nx=((iMouse.x-C.x)*invW)*mAct;
    float ax = abs(nx);
    float stMag = mix(ax, pow(ax, FOG_TILT_SHAPE), 0.35);
    float st = sign(nx) * stMag * uTiltScale;
    st = clamp(st, -FOG_TILT_MAX_X, FOG_TILT_MAX_X);
    vec2 dir=normalize(vec2(st,1.0));
    fuv+=uFogTime*uFogFallSpeed*dir;
    vec2 prp=vec2(-dir.y,dir.x);
    fuv+=prp*(0.08*sin(dot(uvc,prp)*0.08+uFogTime*0.9));
    float n=fbm2(fuv+vec2(fbm2(fuv+vec2(7.3,2.1)),fbm2(fuv+vec2(-3.7,5.9)))*0.6);
    n=pow(clamp(n,0.0,1.0),FOG_CONTRAST);
    float pixW = 1.0 / max(iResolution.y, 1.0);
#ifdef GL_OES_standard_derivatives
    float wL = max(fwidth(L), pixW);
#else
    float wL = pixW;
#endif
    float m0=pow(smoothstep(FOG_BEAM_MIN - wL, FOG_BEAM_MAX + wL, L),FOG_MASK_GAMMA);
    float bm=1.0-pow(1.0-m0,FOG_EXPAND_SHAPE); bm=mix(bm*m0,bm,FOG_EDGE_MIX);
    float yP=1.0-smoothstep(HFOG_Y_RADIUS,HFOG_Y_RADIUS+HFOG_Y_SOFT,abs(yPix));
    float nxF=abs((frag.x-C.x)*invW),hE=1.0-smoothstep(HFOG_EDGE_START,HFOG_EDGE_END,nxF); hE=pow(clamp(hE,0.0,1.0),HFOG_EDGE_GAMMA);
    float hW=mix(1.0,hE,clamp(yP,0.0,1.0));
    float bBias=mix(1.0,1.0-sPix,FOG_BOTTOM_BIAS);
    float browserFogIntensity = uFogIntensity;
    browserFogIntensity *= 1.8;
    float radialFade = 1.0 - smoothstep(0.0, 0.7, length(uvc) / 120.0);
    float safariFog = n * browserFogIntensity * bBias * bm * hW * radialFade;
    fog = safariFog;
#endif
    float LF=L+fog;
    float dith=(h21(frag)-0.5)*(DITHER_STRENGTH/255.0);
    float tone=g(LF+w);
    vec3 col=tone*uColor+dith;
    float alpha=clamp(g(L+w*0.6)+dith*0.6,0.0,1.0);
    float nxE=abs((frag.x-C.x)*invW),xF=pow(clamp(1.0-smoothstep(EDGE_X0,EDGE_X1,nxE),0.0,1.0),EDGE_X_GAMMA);
    float scene=LF+max(0.0,w)*0.5,hi=smoothstep(EDGE_LUMA_T0,EDGE_LUMA_T1,scene);
    float eM=mix(xF,1.0,hi);
    col*=eM; alpha*=eM;
    col*=uFade; alpha*=uFade;
    fc=vec4(col,alpha);
}

void main(){
  vec4 fc;
  mainImage(fc, gl_FragCoord.xy);
  gl_FragColor = fc;
}
`;

export const LaserFlow = ({
  className,
  style,
  wispDensity = 1,
  dpr,
  mouseSmoothTime = 0.0,
  mouseTiltStrength = 0.01,
  horizontalBeamOffset = 0.1,
  verticalBeamOffset = 0.0,
  flowSpeed = 0.35,
  verticalSizing = 2.0,
  horizontalSizing = 0.5,
  fogIntensity = 0.45,
  fogScale = 0.3,
  wispSpeed = 15.0,
  wispIntensity = 5.0,
  flowStrength = 0.25,
  decay = 1.1,
  falloffStart = 1.2,
  fogFallSpeed = 0.6,
  color = "#FF79C6",
}) => {
  const mountRef = useRef(null);
  const rendererRef = useRef(null);
  const uniformsRef = useRef(null);
  const hasFadedRef = useRef(false);
  const rectRef = useRef(null);
  const baseDprRef = useRef(1);
  const currentDprRef = useRef(1);
  const lastSizeRef = useRef({ width: 0, height: 0, dpr: 0 });
  const fpsSamplesRef = useRef([]);
  const lastFpsCheckRef = useRef(performance.now());
  const emaDtRef = useRef(16.7);
  const pausedRef = useRef(false);
  const inViewRef = useRef(true);

  const hexToRGB = (hex) => {
    let c = hex.trim();
    if (c[0] === "#") c = c.slice(1);
    if (c.length === 3)
      c = c
        .split("")
        .map((x) => x + x)
        .join("");
    const n = parseInt(c, 16) || 0xffffff;
    return {
      r: ((n >> 16) & 255) / 255,
      g: ((n >> 8) & 255) / 255,
      b: (n & 255) / 255,
    };
  };

  useEffect(() => {
    const mount = mountRef.current;
    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      failIfMajorPerformanceCaveat: false,
      logarithmicDepthBuffer: false,
    });
    rendererRef.current = renderer;

    baseDprRef.current = Math.min(dpr ?? (window.devicePixelRatio || 1), 2);
    currentDprRef.current = baseDprRef.current;

    renderer.setPixelRatio(currentDprRef.current);
    renderer.shadowMap.enabled = false;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 1);
    const canvas = renderer.domElement;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    mount.appendChild(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]),
        3,
      ),
    );

    const uniforms = {
      iTime: { value: 0 },
      iResolution: { value: new THREE.Vector3(1, 1, 1) },
      iMouse: { value: new THREE.Vector4(0, 0, 0, 0) },
      uWispDensity: { value: wispDensity },
      uTiltScale: { value: mouseTiltStrength },
      uFlowTime: { value: 0 },
      uFogTime: { value: 0 },
      uBeamXFrac: { value: horizontalBeamOffset },
      uBeamYFrac: { value: verticalBeamOffset },
      uFlowSpeed: { value: flowSpeed },
      uVLenFactor: { value: verticalSizing },
      uHLenFactor: { value: horizontalSizing },
      uFogIntensity: { value: fogIntensity },
      uFogScale: { value: fogScale },
      uWSpeed: { value: wispSpeed },
      uWIntensity: { value: wispIntensity },
      uFlowStrength: { value: flowStrength },
      uDecay: { value: decay },
      uFalloffStart: { value: falloffStart },
      uFogFallSpeed: { value: fogFallSpeed },
      uColor: { value: new THREE.Vector3(1, 1, 1) },
      uFade: { value: hasFadedRef.current ? 1 : 0 },
    };
    uniformsRef.current = uniforms;

    const material = new THREE.RawShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms,
      transparent: false,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);

    const clock = new THREE.Clock();
    let prevTime = 0;
    let fade = hasFadedRef.current ? 1 : 0;

    const mouseTarget = new THREE.Vector2(0, 0);
    const mouseSmooth = new THREE.Vector2(0, 0);

    const setSizeNow = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      const pr = currentDprRef.current;

      const last = lastSizeRef.current;
      const sizeChanged =
        Math.abs(w - last.width) > 0.5 || Math.abs(h - last.height) > 0.5;
      const dprChanged = Math.abs(pr - last.dpr) > 0.01;
      if (!sizeChanged && !dprChanged) {
        return;
      }

      lastSizeRef.current = { width: w, height: h, dpr: pr };
      renderer.setPixelRatio(pr);
      renderer.setSize(w, h, false);
      uniforms.iResolution.value.set(w * pr, h * pr, pr);
      rectRef.current = canvas.getBoundingClientRect();

      if (!pausedRef.current) {
        renderer.render(scene, camera);
      }
    };

    let resizeRaf = 0;
    const scheduleResize = () => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(setSizeNow);
    };

    setSizeNow();
    const ro = new ResizeObserver(scheduleResize);
    ro.observe(mount);

    const io = new IntersectionObserver(
      (entries) => {
        inViewRef.current = entries[0]?.isIntersecting ?? true;
      },
      { root: null, threshold: 0 },
    );
    io.observe(mount);

    const onVis = () => {
      pausedRef.current = document.hidden;
    };
    document.addEventListener("visibilitychange", onVis, { passive: true });

    const updateMouse = (clientX, clientY) => {
      const rect = rectRef.current;
      if (!rect) return;
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const ratio = currentDprRef.current;
      const hb = rect.height * ratio;
      mouseTarget.set(x * ratio, hb - y * ratio);
    };
    const onMove = (ev) => updateMouse(ev.clientX, ev.clientY);
    const onLeave = () => mouseTarget.set(0, 0);
    canvas.addEventListener("pointermove", onMove, { passive: true });
    canvas.addEventListener("pointerdown", onMove, { passive: true });
    canvas.addEventListener("pointerenter", onMove, { passive: true });
    canvas.addEventListener("pointerleave", onLeave, { passive: true });

    const onCtxLost = (e) => {
      e.preventDefault();
      pausedRef.current = true;
    };
    const onCtxRestored = () => {
      pausedRef.current = false;
      scheduleResize();
    };
    canvas.addEventListener("webglcontextlost", onCtxLost, false);
    canvas.addEventListener("webglcontextrestored", onCtxRestored, false);

    let raf = 0;

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const dprFloor = 0.6;
    const lowerThresh = 50;
    const upperThresh = 58;
    let lastDprChangeRef = 0;
    const dprChangeCooldown = 2000;

    const adjustDprIfNeeded = (now) => {
      const elapsed = now - lastFpsCheckRef.current;
      if (elapsed < 750) return;

      const samples = fpsSamplesRef.current;
      if (samples.length === 0) {
        lastFpsCheckRef.current = now;
        return;
      }
      const avgFps = samples.reduce((a, b) => a + b, 0) / samples.length;

      let next = currentDprRef.current;
      const base = baseDprRef.current;

      if (avgFps < lowerThresh) {
        next = clamp(currentDprRef.current * 0.85, dprFloor, base);
      } else if (avgFps > upperThresh && currentDprRef.current < base) {
        next = clamp(currentDprRef.current * 1.1, dprFloor, base);
      }

      if (
        Math.abs(next - currentDprRef.current) > 0.01 &&
        now - lastDprChangeRef > dprChangeCooldown
      ) {
        currentDprRef.current = next;
        lastDprChangeRef = now;
        setSizeNow();
      }

      fpsSamplesRef.current = [];
      lastFpsCheckRef.current = now;
    };

    const animate = () => {
      raf = requestAnimationFrame(animate);
      if (pausedRef.current || !inViewRef.current) return;

      const t = clock.getElapsedTime();
      const dt = Math.max(0, t - prevTime);
      prevTime = t;

      const dtMs = dt * 1000;
      emaDtRef.current = emaDtRef.current * 0.9 + dtMs * 0.1;
      const instFps = 1000 / Math.max(1, emaDtRef.current);
      fpsSamplesRef.current.push(instFps);

      uniforms.iTime.value = t;

      const cdt = Math.min(0.033, Math.max(0.001, dt));
      uniforms.uFlowTime.value += cdt;
      uniforms.uFogTime.value += cdt;

      if (!hasFadedRef.current) {
        const fadeDur = 1.0;
        fade = Math.min(1, fade + cdt / fadeDur);
        uniforms.uFade.value = fade;
        if (fade >= 1) hasFadedRef.current = true;
      }

      const tau = Math.max(1e-3, mouseSmoothTime);
      const alpha = 1 - Math.exp(-cdt / tau);
      mouseSmooth.lerp(mouseTarget, alpha);
      uniforms.iMouse.value.set(mouseSmooth.x, mouseSmooth.y, 0, 0);

      renderer.render(scene, camera);

      adjustDprIfNeeded(performance.now());
    };

    animate();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onMove);
      canvas.removeEventListener("pointerenter", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("webglcontextlost", onCtxLost);
      canvas.removeEventListener("webglcontextrestored", onCtxRestored);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (mount.contains(canvas)) mount.removeChild(canvas);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dpr]);

  useEffect(() => {
    const uniforms = uniformsRef.current;
    if (!uniforms) return;

    uniforms.uWispDensity.value = wispDensity;
    uniforms.uTiltScale.value = mouseTiltStrength;
    uniforms.uBeamXFrac.value = horizontalBeamOffset;
    uniforms.uBeamYFrac.value = verticalBeamOffset;
    uniforms.uFlowSpeed.value = flowSpeed;
    uniforms.uVLenFactor.value = verticalSizing;
    uniforms.uHLenFactor.value = horizontalSizing;
    uniforms.uFogIntensity.value = fogIntensity;
    uniforms.uFogScale.value = fogScale;
    uniforms.uWSpeed.value = wispSpeed;
    uniforms.uWIntensity.value = wispIntensity;
    uniforms.uFlowStrength.value = flowStrength;
    uniforms.uDecay.value = decay;
    uniforms.uFalloffStart.value = falloffStart;
    uniforms.uFogFallSpeed.value = fogFallSpeed;

    const { r, g, b } = hexToRGB(color || "#FFFFFF");
    uniforms.uColor.value.set(r, g, b);
  }, [
    wispDensity,
    mouseTiltStrength,
    horizontalBeamOffset,
    verticalBeamOffset,
    flowSpeed,
    verticalSizing,
    horizontalSizing,
    fogIntensity,
    fogScale,
    wispSpeed,
    wispIntensity,
    flowStrength,
    decay,
    falloffStart,
    fogFallSpeed,
    color,
  ]);

  return (
    <div
      ref={mountRef}
      className={`w-full h-full relative ${className || ""}`}
      style={style}
    />
  );
};

export default LaserFlow;
```

### Integration Instructions

1. Install any listed dependencies.
2. Copy the component source into the appropriate directory in the project.
3. Import and render the component using the usage example above as a starting point.
4. Adjust props as needed for the specific use case — refer to the props table for all available options.

# LIGHTINING

## Integrate the <Lightning /> component from React Bits

You are helping integrate an open-source React component into an existing application.

### Component: Lightning

### Variant: JavaScript + Tailwind

---

### Usage Example

```jsx
import Lightning from "./Lightning";

<div style={{ width: "100%", height: "600px", position: "relative" }}>
  <Lightning hue={220} xOffset={0} speed={1} intensity={1} size={1} />
</div>;
```

### Props

| Prop      | Type   | Default | Description                                             |
| --------- | ------ | ------- | ------------------------------------------------------- |
| hue       | number | 230     | Hue of the lightning in degrees (0 to 360).             |
| xOffset   | number | 0       | Horizontal offset of the lightning in normalized units. |
| speed     | number | 1       | Animation speed multiplier for the lightning.           |
| intensity | number | 1       | Brightness multiplier for the lightning.                |
| size      | number | 1       | Scale factor for the bolt size.                         |

### Full Component Source

```jsx
import { useRef, useEffect } from "react";

const Lightning = ({
  hue = 230,
  xOffset = 0,
  speed = 1,
  intensity = 1,
  size = 1,
}) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: false,
    });
    if (!gl) {
      console.error("WebGL not supported");
      return;
    }

    const vertexShaderSource = `
      attribute vec2 aPosition;
      void main() {
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `;

    const fragmentShaderSource = `
      precision mediump float;
      uniform vec2 iResolution;
      uniform float iTime;
      uniform float uHue;
      uniform float uXOffset;
      uniform float uSpeed;
      uniform float uIntensity;
      uniform float uSize;
      
      #define OCTAVE_COUNT 10

      vec3 hsv2rgb(vec3 c) {
          vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0,4.0,2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
          return c.z * mix(vec3(1.0), rgb, c.y);
      }

      float hash11(float p) {
          p = fract(p * .1031);
          p *= p + 33.33;
          p *= p + p;
          return fract(p);
      }

      float hash12(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * .1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
      }

      mat2 rotate2d(float theta) {
          float c = cos(theta);
          float s = sin(theta);
          return mat2(c, -s, s, c);
      }

      float noise(vec2 p) {
          vec2 ip = floor(p);
          vec2 fp = fract(p);
          float a = hash12(ip);
          float b = hash12(ip + vec2(1.0, 0.0));
          float c = hash12(ip + vec2(0.0, 1.0));
          float d = hash12(ip + vec2(1.0, 1.0));
          
          vec2 t = smoothstep(0.0, 1.0, fp);
          return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
      }

      float fbm(vec2 p) {
          float value = 0.0;
          float amplitude = 0.5;
          for (int i = 0; i < OCTAVE_COUNT; ++i) {
              value += amplitude * noise(p);
              p *= rotate2d(0.45);
              p *= 2.0;
              amplitude *= 0.5;
          }
          return value;
      }

      void mainImage( out vec4 fragColor, in vec2 fragCoord ) {
          vec2 uv = fragCoord / iResolution.xy;
          uv = 2.0 * uv - 1.0;
          uv.x *= iResolution.x / iResolution.y;
          uv.x += uXOffset;
          
          uv += 2.0 * fbm(uv * uSize + 0.8 * iTime * uSpeed) - 1.0;
          
          float dist = abs(uv.x);
          vec3 baseColor = hsv2rgb(vec3(uHue / 360.0, 0.7, 0.8));
          vec3 col = baseColor * pow(mix(0.0, 0.07, hash11(iTime * uSpeed)) / dist, 1.0) * uIntensity;
          col = pow(col, vec3(1.0));
          float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
          fragColor = vec4(col, a);
      }

      void main() {
          mainImage(gl_FragColor, gl_FragCoord.xy);
      }
    `;

    const compileShader = (source, type) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("Shader compile error:", gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vertexShader = compileShader(vertexShaderSource, gl.VERTEX_SHADER);
    const fragmentShader = compileShader(
      fragmentShaderSource,
      gl.FRAGMENT_SHADER,
    );
    if (!vertexShader || !fragmentShader) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Program linking error:", gl.getProgramInfoLog(program));
      return;
    }
    gl.useProgram(program);

    const vertices = new Float32Array([
      -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
    ]);
    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const aPosition = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

    const iResolutionLocation = gl.getUniformLocation(program, "iResolution");
    const iTimeLocation = gl.getUniformLocation(program, "iTime");
    const uHueLocation = gl.getUniformLocation(program, "uHue");
    const uXOffsetLocation = gl.getUniformLocation(program, "uXOffset");
    const uSpeedLocation = gl.getUniformLocation(program, "uSpeed");
    const uIntensityLocation = gl.getUniformLocation(program, "uIntensity");
    const uSizeLocation = gl.getUniformLocation(program, "uSize");

    const startTime = performance.now();
    const render = () => {
      resizeCanvas();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(iResolutionLocation, canvas.width, canvas.height);
      const currentTime = performance.now();
      gl.uniform1f(iTimeLocation, (currentTime - startTime) / 1000.0);
      gl.uniform1f(uHueLocation, hue);
      gl.uniform1f(uXOffsetLocation, xOffset);
      gl.uniform1f(uSpeedLocation, speed);
      gl.uniform1f(uIntensityLocation, intensity);
      gl.uniform1f(uSizeLocation, size);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);

    return () => {
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [hue, xOffset, speed, intensity, size]);

  return <canvas ref={canvasRef} className="w-full h-full relative" />;
};

export default Lightning;
```

### Integration Instructions

1. Install any listed dependencies.
2. Copy the component source into the appropriate directory in the project.
3. Import and render the component using the usage example above as a starting point.
4. Adjust props as needed for the specific use case — refer to the props table for all available options.

# LIGHT RAYS

## Integrate the <LightRays /> component from React Bits

You are helping integrate an open-source React component into an existing application.

### Component: LightRays

### Variant: JavaScript + Tailwind

### Dependencies: ogl

---

### Usage Example

```jsx
import LightRays from "./LightRays";

<div style={{ width: "100%", height: "600px", position: "relative" }}>
  <LightRays
    raysOrigin="top-center"
    raysColor="#00ffff"
    raysSpeed={1.5}
    lightSpread={0.8}
    rayLength={1.2}
    followMouse={true}
    mouseInfluence={0.1}
    noiseAmount={0.1}
    distortion={0.05}
    className="custom-rays"
  />
</div>;
```

### Props

| Prop           | Type       | Default      | Description                                                                                                                                        |
| -------------- | ---------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| raysOrigin     | RaysOrigin | "top-center" | Origin position of the light rays. Options: 'top-center', 'top-left', 'top-right', 'right', 'left', 'bottom-center', 'bottom-right', 'bottom-left' |
| raysColor      | string     | "#ffffff"    | Color of the light rays in hex format                                                                                                              |
| raysSpeed      | number     | 1            | Animation speed of the rays                                                                                                                        |
| lightSpread    | number     | 0.5          | How wide the light rays spread. Lower values = tighter rays, higher values = wider spread                                                          |
| rayLength      | number     | 1.0          | Maximum length/reach of the rays                                                                                                                   |
| pulsating      | boolean    | false        | Enable pulsing animation effect                                                                                                                    |
| fadeDistance   | number     | 1.0          | How far rays fade out from origin                                                                                                                  |
| saturation     | number     | 1.0          | Color saturation level (0-1)                                                                                                                       |
| followMouse    | boolean    | false        | Make rays rotate towards the mouse cursor                                                                                                          |
| mouseInfluence | number     | 0.5          | How much mouse affects rays (0-1)                                                                                                                  |
| noiseAmount    | number     | 0.0          | Add noise/grain to rays (0-1)                                                                                                                      |
| distortion     | number     | 0.0          | Apply wave distortion to rays                                                                                                                      |
| className      | string     | ""           | Additional CSS classes to apply to the container                                                                                                   |

### Full Component Source

```jsx
import { useRef, useEffect, useState } from "react";
import { Renderer, Program, Triangle, Mesh } from "ogl";

const DEFAULT_COLOR = "#ffffff";

const hexToRgb = (hex) => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m
    ? [
        parseInt(m[1], 16) / 255,
        parseInt(m[2], 16) / 255,
        parseInt(m[3], 16) / 255,
      ]
    : [1, 1, 1];
};

const getAnchorAndDir = (origin, w, h) => {
  const outside = 0.2;
  switch (origin) {
    case "top-left":
      return { anchor: [0, -outside * h], dir: [0, 1] };
    case "top-right":
      return { anchor: [w, -outside * h], dir: [0, 1] };
    case "left":
      return { anchor: [-outside * w, 0.5 * h], dir: [1, 0] };
    case "right":
      return { anchor: [(1 + outside) * w, 0.5 * h], dir: [-1, 0] };
    case "bottom-left":
      return { anchor: [0, (1 + outside) * h], dir: [0, -1] };
    case "bottom-center":
      return { anchor: [0.5 * w, (1 + outside) * h], dir: [0, -1] };
    case "bottom-right":
      return { anchor: [w, (1 + outside) * h], dir: [0, -1] };
    default: // "top-center"
      return { anchor: [0.5 * w, -outside * h], dir: [0, 1] };
  }
};

const LightRays = ({
  raysOrigin = "top-center",
  raysColor = DEFAULT_COLOR,
  raysSpeed = 1,
  lightSpread = 1,
  rayLength = 2,
  pulsating = false,
  fadeDistance = 1.0,
  saturation = 1.0,
  followMouse = true,
  mouseInfluence = 0.1,
  noiseAmount = 0.0,
  distortion = 0.0,
  className = "",
}) => {
  const containerRef = useRef(null);
  const uniformsRef = useRef(null);
  const rendererRef = useRef(null);
  const mouseRef = useRef({ x: 0.5, y: 0.5 });
  const smoothMouseRef = useRef({ x: 0.5, y: 0.5 });
  const animationIdRef = useRef(null);
  const meshRef = useRef(null);
  const cleanupFunctionRef = useRef(null);
  const [isVisible, setIsVisible] = useState(false);
  const observerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.1 },
    );

    observerRef.current.observe(containerRef.current);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isVisible || !containerRef.current) return;

    if (cleanupFunctionRef.current) {
      cleanupFunctionRef.current();
      cleanupFunctionRef.current = null;
    }

    const initializeWebGL = async () => {
      if (!containerRef.current) return;

      await new Promise((resolve) => setTimeout(resolve, 10));

      if (!containerRef.current) return;

      const renderer = new Renderer({
        dpr: Math.min(window.devicePixelRatio, 2),
        alpha: true,
      });
      rendererRef.current = renderer;

      const gl = renderer.gl;
      gl.canvas.style.width = "100%";
      gl.canvas.style.height = "100%";

      while (containerRef.current.firstChild) {
        containerRef.current.removeChild(containerRef.current.firstChild);
      }
      containerRef.current.appendChild(gl.canvas);

      const vert = `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

      const frag = `precision highp float;

uniform float iTime;
uniform vec2  iResolution;

uniform vec2  rayPos;
uniform vec2  rayDir;
uniform vec3  raysColor;
uniform float raysSpeed;
uniform float lightSpread;
uniform float rayLength;
uniform float pulsating;
uniform float fadeDistance;
uniform float saturation;
uniform vec2  mousePos;
uniform float mouseInfluence;
uniform float noiseAmount;
uniform float distortion;

varying vec2 vUv;

float noise(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

float rayStrength(vec2 raySource, vec2 rayRefDirection, vec2 coord,
                  float seedA, float seedB, float speed) {
  vec2 sourceToCoord = coord - raySource;
  vec2 dirNorm = normalize(sourceToCoord);
  float cosAngle = dot(dirNorm, rayRefDirection);

  float distortedAngle = cosAngle + distortion * sin(iTime * 2.0 + length(sourceToCoord) * 0.01) * 0.2;
  
  float spreadFactor = pow(max(distortedAngle, 0.0), 1.0 / max(lightSpread, 0.001));

  float distance = length(sourceToCoord);
  float maxDistance = iResolution.x * rayLength;
  float lengthFalloff = clamp((maxDistance - distance) / maxDistance, 0.0, 1.0);
  
  float fadeFalloff = clamp((iResolution.x * fadeDistance - distance) / (iResolution.x * fadeDistance), 0.5, 1.0);
  float pulse = pulsating > 0.5 ? (0.8 + 0.2 * sin(iTime * speed * 3.0)) : 1.0;

  float baseStrength = clamp(
    (0.45 + 0.15 * sin(distortedAngle * seedA + iTime * speed)) +
    (0.3 + 0.2 * cos(-distortedAngle * seedB + iTime * speed)),
    0.0, 1.0
  );

  return baseStrength * lengthFalloff * fadeFalloff * spreadFactor * pulse;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = vec2(fragCoord.x, iResolution.y - fragCoord.y);
  
  vec2 finalRayDir = rayDir;
  if (mouseInfluence > 0.0) {
    vec2 mouseScreenPos = mousePos * iResolution.xy;
    vec2 mouseDirection = normalize(mouseScreenPos - rayPos);
    finalRayDir = normalize(mix(rayDir, mouseDirection, mouseInfluence));
  }

  vec4 rays1 = vec4(1.0) *
               rayStrength(rayPos, finalRayDir, coord, 36.2214, 21.11349,
                           1.5 * raysSpeed);
  vec4 rays2 = vec4(1.0) *
               rayStrength(rayPos, finalRayDir, coord, 22.3991, 18.0234,
                           1.1 * raysSpeed);

  fragColor = rays1 * 0.5 + rays2 * 0.4;

  if (noiseAmount > 0.0) {
    float n = noise(coord * 0.01 + iTime * 0.1);
    fragColor.rgb *= (1.0 - noiseAmount + noiseAmount * n);
  }

  float brightness = 1.0 - (coord.y / iResolution.y);
  fragColor.x *= 0.1 + brightness * 0.8;
  fragColor.y *= 0.3 + brightness * 0.6;
  fragColor.z *= 0.5 + brightness * 0.5;

  if (saturation != 1.0) {
    float gray = dot(fragColor.rgb, vec3(0.299, 0.587, 0.114));
    fragColor.rgb = mix(vec3(gray), fragColor.rgb, saturation);
  }

  fragColor.rgb *= raysColor;
}

void main() {
  vec4 color;
  mainImage(color, gl_FragCoord.xy);
  gl_FragColor  = color;
}`;

      const uniforms = {
        iTime: { value: 0 },
        iResolution: { value: [1, 1] },

        rayPos: { value: [0, 0] },
        rayDir: { value: [0, 1] },

        raysColor: { value: hexToRgb(raysColor) },
        raysSpeed: { value: raysSpeed },
        lightSpread: { value: lightSpread },
        rayLength: { value: rayLength },
        pulsating: { value: pulsating ? 1.0 : 0.0 },
        fadeDistance: { value: fadeDistance },
        saturation: { value: saturation },
        mousePos: { value: [0.5, 0.5] },
        mouseInfluence: { value: mouseInfluence },
        noiseAmount: { value: noiseAmount },
        distortion: { value: distortion },
      };
      uniformsRef.current = uniforms;

      const geometry = new Triangle(gl);
      const program = new Program(gl, {
        vertex: vert,
        fragment: frag,
        uniforms,
      });
      const mesh = new Mesh(gl, { geometry, program });
      meshRef.current = mesh;

      const updatePlacement = () => {
        if (!containerRef.current || !renderer) return;

        renderer.dpr = Math.min(window.devicePixelRatio, 2);

        const { clientWidth: wCSS, clientHeight: hCSS } = containerRef.current;
        renderer.setSize(wCSS, hCSS);

        const dpr = renderer.dpr;
        const w = wCSS * dpr;
        const h = hCSS * dpr;

        uniforms.iResolution.value = [w, h];

        const { anchor, dir } = getAnchorAndDir(raysOrigin, w, h);
        uniforms.rayPos.value = anchor;
        uniforms.rayDir.value = dir;
      };

      const loop = (t) => {
        if (!rendererRef.current || !uniformsRef.current || !meshRef.current) {
          return;
        }

        uniforms.iTime.value = t * 0.001;

        if (followMouse && mouseInfluence > 0.0) {
          const smoothing = 0.92;

          smoothMouseRef.current.x =
            smoothMouseRef.current.x * smoothing +
            mouseRef.current.x * (1 - smoothing);
          smoothMouseRef.current.y =
            smoothMouseRef.current.y * smoothing +
            mouseRef.current.y * (1 - smoothing);

          uniforms.mousePos.value = [
            smoothMouseRef.current.x,
            smoothMouseRef.current.y,
          ];
        }

        try {
          renderer.render({ scene: mesh });
          animationIdRef.current = requestAnimationFrame(loop);
        } catch (error) {
          console.warn("WebGL rendering error:", error);
          return;
        }
      };

      window.addEventListener("resize", updatePlacement);
      updatePlacement();
      animationIdRef.current = requestAnimationFrame(loop);

      cleanupFunctionRef.current = () => {
        if (animationIdRef.current) {
          cancelAnimationFrame(animationIdRef.current);
          animationIdRef.current = null;
        }

        window.removeEventListener("resize", updatePlacement);

        if (renderer) {
          try {
            const canvas = renderer.gl.canvas;
            const loseContextExt =
              renderer.gl.getExtension("WEBGL_lose_context");
            if (loseContextExt) {
              loseContextExt.loseContext();
            }

            if (canvas && canvas.parentNode) {
              canvas.parentNode.removeChild(canvas);
            }
          } catch (error) {
            console.warn("Error during WebGL cleanup:", error);
          }
        }

        rendererRef.current = null;
        uniformsRef.current = null;
        meshRef.current = null;
      };
    };

    initializeWebGL();

    return () => {
      if (cleanupFunctionRef.current) {
        cleanupFunctionRef.current();
        cleanupFunctionRef.current = null;
      }
    };
  }, [
    isVisible,
    raysOrigin,
    raysColor,
    raysSpeed,
    lightSpread,
    rayLength,
    pulsating,
    fadeDistance,
    saturation,
    followMouse,
    mouseInfluence,
    noiseAmount,
    distortion,
  ]);

  useEffect(() => {
    if (!uniformsRef.current || !containerRef.current || !rendererRef.current)
      return;

    const u = uniformsRef.current;
    const renderer = rendererRef.current;

    u.raysColor.value = hexToRgb(raysColor);
    u.raysSpeed.value = raysSpeed;
    u.lightSpread.value = lightSpread;
    u.rayLength.value = rayLength;
    u.pulsating.value = pulsating ? 1.0 : 0.0;
    u.fadeDistance.value = fadeDistance;
    u.saturation.value = saturation;
    u.mouseInfluence.value = mouseInfluence;
    u.noiseAmount.value = noiseAmount;
    u.distortion.value = distortion;

    const { clientWidth: wCSS, clientHeight: hCSS } = containerRef.current;
    const dpr = renderer.dpr;
    const { anchor, dir } = getAnchorAndDir(raysOrigin, wCSS * dpr, hCSS * dpr);
    u.rayPos.value = anchor;
    u.rayDir.value = dir;
  }, [
    raysColor,
    raysSpeed,
    lightSpread,
    raysOrigin,
    rayLength,
    pulsating,
    fadeDistance,
    saturation,
    mouseInfluence,
    noiseAmount,
    distortion,
  ]);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!containerRef.current || !rendererRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      mouseRef.current = { x, y };
    };

    if (followMouse) {
      window.addEventListener("mousemove", handleMouseMove);
      return () => window.removeEventListener("mousemove", handleMouseMove);
    }
  }, [followMouse]);

  return (
    <div
      ref={containerRef}
      className={`w-full h-full pointer-events-none z-[3] overflow-hidden relative ${className}`.trim()}
    />
  );
};

export default LightRays;
```

### Integration Instructions

1. Install any listed dependencies.
2. Copy the component source into the appropriate directory in the project.
3. Import and render the component using the usage example above as a starting point.
4. Adjust props as needed for the specific use case — refer to the props table for all available options.

# LIGHT PILLAR

## Integrate the <LightPillar /> component from React Bits

You are helping integrate an open-source React component into an existing application.

### Component: LightPillar

### Variant: JavaScript + Tailwind

### Dependencies: three

---

### Usage Example

```jsx
import LightPillar from "./LightPillar";

<div style={{ width: "100%", height: "600px", position: "relative" }}>
  <LightPillar
    topColor="#5227FF"
    bottomColor="#FF9FFC"
    intensity={1.0}
    rotationSpeed={0.3}
    glowAmount={0.005}
    pillarWidth={3.0}
    pillarHeight={0.4}
    noiseIntensity={0.5}
    pillarRotation={0}
    interactive={false}
    mixBlendMode="normal"
  />
</div>;
```

### Props

| Prop           | Type    | Default   | Description                                                                          |
| -------------- | ------- | --------- | ------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| topColor       | string  | '#5227FF' | Hex color string for the top gradient color of the light pillar.                     |
| bottomColor    | string  | '#FF9FFC' | Hex color string for the bottom gradient color of the light pillar.                  |
| intensity      | number  | 1.0       | Controls the overall brightness and intensity of the effect.                         |
| rotationSpeed  | number  | 0.3       | Speed multiplier for the pillar rotation animation.                                  |
| interactive    | boolean | false     | Enable mouse interaction to control the pillar rotation.                             |
| glowAmount     | number  | 0.005     | Controls the glow intensity and spread of the light effect.                          |
| pillarWidth    | number  | 3.0       | Width/radius of the light pillar.                                                    |
| pillarHeight   | number  | 0.4       | Height scaling factor for the pillar distortion.                                     |
| noiseIntensity | number  | 0.5       | Intensity of the film grain noise postprocessing effect.                             |
| className      | string  | ''        | Additional CSS class names to apply to the container element.                        |
| mixBlendMode   | string  | 'screen'  | CSS mix-blend-mode property to control how the component blends with its background. |
| pillarRotation | number  | 0         | Rotation angle of the pillar in degrees (0-360).                                     |
| quality        | 'low'   | 'medium'  | 'high'                                                                               | 'high' | Rendering quality level. Lower settings improve performance on mobile devices. Mobile devices automatically downgrade from high to medium. |

### Full Component Source

```jsx
import { useRef, useEffect, useState } from "react";
import * as THREE from "three";

const LightPillar = ({
  topColor = "#5227FF",
  bottomColor = "#FF9FFC",
  intensity = 1.0,
  rotationSpeed = 0.3,
  interactive = false,
  className = "",
  glowAmount = 0.005,
  pillarWidth = 3.0,
  pillarHeight = 0.4,
  noiseIntensity = 0.5,
  mixBlendMode = "screen",
  pillarRotation = 0,
  quality = "high",
}) => {
  const containerRef = useRef(null);
  const rafRef = useRef(null);
  const rendererRef = useRef(null);
  const materialRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const geometryRef = useRef(null);
  const mouseRef = useRef(new THREE.Vector2(0, 0));
  const timeRef = useRef(0);
  const rotationSpeedRef = useRef(rotationSpeed);
  const [webGLSupported, setWebGLSupported] = useState(true);

  // Check WebGL support
  useEffect(() => {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) {
      setWebGLSupported(false);
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current || !webGLSupported) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene setup
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    cameraRef.current = camera;

    const isMobile =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent,
      );
    const isLowEndDevice =
      isMobile ||
      (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);

    let effectiveQuality = quality;
    if (isLowEndDevice && quality === "high") effectiveQuality = "medium";
    if (isMobile && quality !== "low") effectiveQuality = "low";

    const qualitySettings = {
      low: {
        iterations: 24,
        waveIterations: 1,
        pixelRatio: 0.5,
        precision: "mediump",
        stepMultiplier: 1.5,
      },
      medium: {
        iterations: 40,
        waveIterations: 2,
        pixelRatio: 0.65,
        precision: "mediump",
        stepMultiplier: 1.2,
      },
      high: {
        iterations: 80,
        waveIterations: 4,
        pixelRatio: Math.min(window.devicePixelRatio, 2),
        precision: "highp",
        stepMultiplier: 1.0,
      },
    };

    const settings =
      qualitySettings[effectiveQuality] || qualitySettings.medium;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: true,
        powerPreference:
          effectiveQuality === "high" ? "high-performance" : "low-power",
        precision: settings.precision,
        stencil: false,
        depth: false,
      });
    } catch (error) {
      setWebGLSupported(false);
      return;
    }

    renderer.setSize(width, height);
    renderer.setPixelRatio(settings.pixelRatio);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const parseColor = (hex) => {
      const color = new THREE.Color(hex);
      return new THREE.Vector3(color.r, color.g, color.b);
    };

    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      precision ${settings.precision} float;

      uniform float uTime;
      uniform vec2 uResolution;
      uniform vec2 uMouse;
      uniform vec3 uTopColor;
      uniform vec3 uBottomColor;
      uniform float uIntensity;
      uniform bool uInteractive;
      uniform float uGlowAmount;
      uniform float uPillarWidth;
      uniform float uPillarHeight;
      uniform float uNoiseIntensity;
      uniform float uRotCos;
      uniform float uRotSin;
      uniform float uPillarRotCos;
      uniform float uPillarRotSin;
      uniform float uWaveSin;
      uniform float uWaveCos;
      varying vec2 vUv;

      const float STEP_MULT = ${settings.stepMultiplier.toFixed(1)};
      const int MAX_ITER = ${settings.iterations};
      const int WAVE_ITER = ${settings.waveIterations};

      void main() {
        vec2 uv = (vUv * 2.0 - 1.0) * vec2(uResolution.x / uResolution.y, 1.0);
        uv = vec2(uPillarRotCos * uv.x - uPillarRotSin * uv.y, uPillarRotSin * uv.x + uPillarRotCos * uv.y);

        vec3 ro = vec3(0.0, 0.0, -10.0);
        vec3 rd = normalize(vec3(uv, 1.0));

        float rotC = uRotCos;
        float rotS = uRotSin;
        if(uInteractive && (uMouse.x != 0.0 || uMouse.y != 0.0)) {
          float a = uMouse.x * 6.283185;
          rotC = cos(a);
          rotS = sin(a);
        }

        vec3 col = vec3(0.0);
        float t = 0.1;
        
        for(int i = 0; i < MAX_ITER; i++) {
          vec3 p = ro + rd * t;
          p.xz = vec2(rotC * p.x - rotS * p.z, rotS * p.x + rotC * p.z);

          vec3 q = p;
          q.y = p.y * uPillarHeight + uTime;
          
          float freq = 1.0;
          float amp = 1.0;
          for(int j = 0; j < WAVE_ITER; j++) {
            q.xz = vec2(uWaveCos * q.x - uWaveSin * q.z, uWaveSin * q.x + uWaveCos * q.z);
            q += cos(q.zxy * freq - uTime * float(j) * 2.0) * amp;
            freq *= 2.0;
            amp *= 0.5;
          }
          
          float d = length(cos(q.xz)) - 0.2;
          float bound = length(p.xz) - uPillarWidth;
          float k = 4.0;
          float h = max(k - abs(d - bound), 0.0);
          d = max(d, bound) + h * h * 0.0625 / k;
          d = abs(d) * 0.15 + 0.01;

          float grad = clamp((15.0 - p.y) / 30.0, 0.0, 1.0);
          col += mix(uBottomColor, uTopColor, grad) / d;

          t += d * STEP_MULT;
          if(t > 50.0) break;
        }

        float widthNorm = uPillarWidth / 3.0;
        col = tanh(col * uGlowAmount / widthNorm);
        
        col -= fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) / 15.0 * uNoiseIntensity;
        
        gl_FragColor = vec4(col * uIntensity, 1.0);
      }
    `;

    const pillarRotRad = (pillarRotation * Math.PI) / 180;
    const waveSin = Math.sin(0.4);
    const waveCos = Math.cos(0.4);

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(width, height) },
        uMouse: { value: mouseRef.current },
        uTopColor: { value: parseColor(topColor) },
        uBottomColor: { value: parseColor(bottomColor) },
        uIntensity: { value: intensity },
        uInteractive: { value: interactive },
        uGlowAmount: { value: glowAmount },
        uPillarWidth: { value: pillarWidth },
        uPillarHeight: { value: pillarHeight },
        uNoiseIntensity: { value: noiseIntensity },
        uRotCos: { value: 1.0 },
        uRotSin: { value: 0.0 },
        uPillarRotCos: { value: Math.cos(pillarRotRad) },
        uPillarRotSin: { value: Math.sin(pillarRotRad) },
        uWaveSin: { value: waveSin },
        uWaveCos: { value: waveCos },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    materialRef.current = material;

    const geometry = new THREE.PlaneGeometry(2, 2);
    geometryRef.current = geometry;
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    let mouseMoveTimeout = null;
    const handleMouseMove = (event) => {
      if (!interactive) return;

      if (mouseMoveTimeout) return;

      mouseMoveTimeout = window.setTimeout(() => {
        mouseMoveTimeout = null;
      }, 16);

      const rect = container.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      mouseRef.current.set(x, y);
    };

    if (interactive) {
      container.addEventListener("mousemove", handleMouseMove, {
        passive: true,
      });
    }

    let lastTime = performance.now();
    const targetFPS = effectiveQuality === "low" ? 30 : 60;
    const frameTime = 1000 / targetFPS;

    const animate = (currentTime) => {
      if (
        !materialRef.current ||
        !rendererRef.current ||
        !sceneRef.current ||
        !cameraRef.current
      )
        return;

      const deltaTime = currentTime - lastTime;

      if (deltaTime >= frameTime) {
        timeRef.current += 0.016 * rotationSpeedRef.current;
        const t = timeRef.current;
        materialRef.current.uniforms.uTime.value = t;
        materialRef.current.uniforms.uRotCos.value = Math.cos(t * 0.3);
        materialRef.current.uniforms.uRotSin.value = Math.sin(t * 0.3);
        rendererRef.current.render(sceneRef.current, cameraRef.current);
        lastTime = currentTime - (deltaTime % frameTime);
      }

      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);

    let resizeTimeout = null;
    const handleResize = () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }

      resizeTimeout = window.setTimeout(() => {
        if (
          !rendererRef.current ||
          !materialRef.current ||
          !containerRef.current
        )
          return;
        const newWidth = containerRef.current.clientWidth;
        const newHeight = containerRef.current.clientHeight;
        rendererRef.current.setSize(newWidth, newHeight);
        materialRef.current.uniforms.uResolution.value.set(newWidth, newHeight);
      }, 150);
    };

    window.addEventListener("resize", handleResize, { passive: true });

    return () => {
      window.removeEventListener("resize", handleResize);
      if (interactive) {
        container.removeEventListener("mousemove", handleMouseMove);
      }
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current.forceContextLoss();
        if (container.contains(rendererRef.current.domElement)) {
          container.removeChild(rendererRef.current.domElement);
        }
      }
      if (materialRef.current) {
        materialRef.current.dispose();
      }
      if (geometryRef.current) {
        geometryRef.current.dispose();
      }

      rendererRef.current = null;
      materialRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      geometryRef.current = null;
      rafRef.current = null;
    };
  }, [webGLSupported, quality]);

  useEffect(() => {
    rotationSpeedRef.current = rotationSpeed;
  }, [rotationSpeed]);

  useEffect(() => {
    if (!materialRef.current) return;
    const parseColor = (hex) => {
      const color = new THREE.Color(hex);
      return new THREE.Vector3(color.r, color.g, color.b);
    };
    materialRef.current.uniforms.uTopColor.value = parseColor(topColor);
  }, [topColor]);

  useEffect(() => {
    if (!materialRef.current) return;
    const parseColor = (hex) => {
      const color = new THREE.Color(hex);
      return new THREE.Vector3(color.r, color.g, color.b);
    };
    materialRef.current.uniforms.uBottomColor.value = parseColor(bottomColor);
  }, [bottomColor]);

  useEffect(() => {
    if (!materialRef.current) return;
    materialRef.current.uniforms.uIntensity.value = intensity;
  }, [intensity]);

  useEffect(() => {
    if (!materialRef.current) return;
    materialRef.current.uniforms.uInteractive.value = interactive;
  }, [interactive]);

  useEffect(() => {
    if (!materialRef.current) return;
    materialRef.current.uniforms.uGlowAmount.value = glowAmount;
  }, [glowAmount]);

  useEffect(() => {
    if (!materialRef.current) return;
    materialRef.current.uniforms.uPillarWidth.value = pillarWidth;
  }, [pillarWidth]);

  useEffect(() => {
    if (!materialRef.current) return;
    materialRef.current.uniforms.uPillarHeight.value = pillarHeight;
  }, [pillarHeight]);

  useEffect(() => {
    if (!materialRef.current) return;
    materialRef.current.uniforms.uNoiseIntensity.value = noiseIntensity;
  }, [noiseIntensity]);

  useEffect(() => {
    if (!materialRef.current) return;
    const pillarRotRad = (pillarRotation * Math.PI) / 180;
    materialRef.current.uniforms.uPillarRotCos.value = Math.cos(pillarRotRad);
    materialRef.current.uniforms.uPillarRotSin.value = Math.sin(pillarRotRad);
  }, [pillarRotation]);

  if (!webGLSupported) {
    return (
      <div
        className={`w-full h-full absolute top-0 left-0 flex items-center justify-center bg-black/10 text-gray-500 text-sm ${className}`}
        style={{ mixBlendMode }}
      >
        WebGL not supported
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`w-full h-full absolute top-0 left-0 ${className}`}
      style={{ mixBlendMode }}
    />
  );
};

export default LightPillar;
```

### Integration Instructions

1. Install any listed dependencies.
2. Copy the component source into the appropriate directory in the project.
3. Import and render the component using the usage example above as a starting point.
4. Adjust props as needed for the specific use case — refer to the props table for all available options.

# MAGIC RINGS

## Integrate the <MagicRings /> component from React Bits

You are helping integrate an open-source React component into an existing application.

### Component: MagicRings

### Variant: JavaScript + Tailwind

---

### Usage Example

```jsx
import MagicRings from "./MagicRings";

<div style={{ width: "600px", height: "400px", position: "relative" }}>
  <MagicRings
    color="#fc42ff"
    colorTwo="#42fcff"
    ringCount={6}
    speed={1}
    attenuation={10}
    lineThickness={2}
    baseRadius={0.35}
    radiusStep={0.1}
    scaleRate={0.1}
    opacity={1}
    blur={0}
    noiseAmount={0.1}
    rotation={0}
    ringGap={1.5}
    fadeIn={0.7}
    fadeOut={0.5}
    followMouse={false}
    mouseInfluence={0.2}
    hoverScale={1.2}
    parallax={0.05}
    clickBurst={false}
  />
</div>;
```

### Props

| Prop           | Type    | Default   | Description                                              |
| -------------- | ------- | --------- | -------------------------------------------------------- |
| color          | string  | "#A855F7" | Hex color for the rings.                                 |
| colorTwo       | string  | "#6366F1" | Second color — rings interpolate from color to colorTwo. |
| ringCount      | number  | 6         | Number of concentric rings to draw (1–10).               |
| speed          | number  | 1         | Animation speed multiplier.                              |
| attenuation    | number  | 10        | Glow falloff — higher values produce tighter glow.       |
| lineThickness  | number  | 2         | Thickness of each ring line.                             |
| baseRadius     | number  | 0.35      | Radius of the innermost ring (normalized).               |
| radiusStep     | number  | 0.1       | Spacing between successive rings.                        |
| scaleRate      | number  | 0.1       | How much rings expand over time.                         |
| opacity        | number  | 1         | Overall opacity of the effect (0–1).                     |
| blur           | number  | 0         | CSS blur in px — creates a bloom/glow effect.            |
| noiseAmount    | number  | 0.1       | Film-grain noise intensity.                              |
| rotation       | number  | 0         | Static rotation of the pattern in degrees.               |
| ringGap        | number  | 1.5       | Exponential base for angular cutaway per ring.           |
| fadeIn         | number  | 0.7       | Duration of ring fade-in within cycle.                   |
| fadeOut        | number  | 0.5       | Start time of ring fade-out within cycle.                |
| followMouse    | boolean | false     | Rings shift toward the mouse cursor.                     |
| mouseInfluence | number  | 0.2       | Strength of mouse follow (when followMouse is true).     |
| hoverScale     | number  | 1.2       | Scale multiplier on hover.                               |
| parallax       | number  | 0.05      | Per-ring depth offset based on mouse position.           |
| clickBurst     | boolean | false     | Click triggers a brightness flash and scale pulse.       |

### Full Component Source

```jsx
import { useEffect, useRef } from "react";
import * as THREE from "three";

const vertexShader = `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = `
precision highp float;

uniform float uTime, uAttenuation, uLineThickness;
uniform float uBaseRadius, uRadiusStep, uScaleRate;
uniform float uOpacity, uNoiseAmount, uRotation, uRingGap;
uniform float uFadeIn, uFadeOut;
uniform float uMouseInfluence, uHoverAmount, uHoverScale, uParallax, uBurst;
uniform vec2 uResolution, uMouse;
uniform vec3 uColor, uColorTwo;
uniform int uRingCount;

const float HP = 1.5707963;
const float CYCLE = 3.45;

float fade(float t) {
  return t < uFadeIn ? smoothstep(0.0, uFadeIn, t) : 1.0 - smoothstep(uFadeOut, CYCLE - 0.2, t);
}

float ring(vec2 p, float ri, float cut, float t0, float px) {
  float t = mod(uTime + t0, CYCLE);
  float r = ri + t / CYCLE * uScaleRate;
  float d = abs(length(p) - r);
  float a = atan(abs(p.y), abs(p.x)) / HP;
  float th = max(1.0 - a, 0.5) * px * uLineThickness;
  float h = (1.0 - smoothstep(th, th * 1.5, d)) + 1.0;
  d += pow(cut * a, 3.0) * r;
  return h * exp(-uAttenuation * d) * fade(t);
}

void main() {
  float px = 1.0 / min(uResolution.x, uResolution.y);
  vec2 p = (gl_FragCoord.xy - 0.5 * uResolution.xy) * px;
  float cr = cos(uRotation), sr = sin(uRotation);
  p = mat2(cr, -sr, sr, cr) * p;
  p -= uMouse * uMouseInfluence;
  float sc = mix(1.0, uHoverScale, uHoverAmount) + uBurst * 0.3;
  p /= sc;
  vec3 c = vec3(0.0);
  float rcf = max(float(uRingCount) - 1.0, 1.0);
  for (int i = 0; i < 10; i++) {
    if (i >= uRingCount) break;
    float fi = float(i);
    vec2 pr = p - fi * uParallax * uMouse;
    vec3 rc = mix(uColor, uColorTwo, fi / rcf);
    c = mix(c, rc, vec3(ring(pr, uBaseRadius + fi * uRadiusStep, pow(uRingGap, fi), i == 0 ? 0.0 : 2.95 * fi, px)));
  }
  c *= 1.0 + uBurst * 2.0;
  float n = fract(sin(dot(gl_FragCoord.xy + uTime * 100.0, vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) * uNoiseAmount;
  gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)) * uOpacity);
}
`;

export default function MagicRings({
  color = "#fc42ff",
  colorTwo = "#42fcff",
  speed = 1,
  ringCount = 6,
  attenuation = 10,
  lineThickness = 2,
  baseRadius = 0.35,
  radiusStep = 0.1,
  scaleRate = 0.1,
  opacity = 1,
  blur = 0,
  noiseAmount = 0.1,
  rotation = 0,
  ringGap = 1.5,
  fadeIn = 0.7,
  fadeOut = 0.5,
  followMouse = false,
  mouseInfluence = 0.2,
  hoverScale = 1.2,
  parallax = 0.05,
  clickBurst = false,
}) {
  const mountRef = useRef(null);
  const propsRef = useRef(null);
  const mouseRef = useRef([0, 0]);
  const smoothMouseRef = useRef([0, 0]);
  const hoverAmountRef = useRef(0);
  const isHoveredRef = useRef(false);
  const burstRef = useRef(0);

  propsRef.current = {
    color,
    colorTwo,
    speed,
    ringCount,
    attenuation,
    lineThickness,
    baseRadius,
    radiusStep,
    scaleRate,
    opacity,
    noiseAmount,
    rotation,
    ringGap,
    fadeIn,
    fadeOut,
    followMouse,
    mouseInfluence,
    hoverScale,
    parallax,
    clickBurst,
  };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true });
    } catch {
      return;
    }

    if (!renderer.capabilities.isWebGL2) {
      renderer.dispose();
      return;
    }

    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10);
    camera.position.z = 1;

    const uniforms = {
      uTime: { value: 0 },
      uAttenuation: { value: 0 },
      uResolution: { value: new THREE.Vector2() },
      uColor: { value: new THREE.Color() },
      uColorTwo: { value: new THREE.Color() },
      uLineThickness: { value: 0 },
      uBaseRadius: { value: 0 },
      uRadiusStep: { value: 0 },
      uScaleRate: { value: 0 },
      uRingCount: { value: 0 },
      uOpacity: { value: 1 },
      uNoiseAmount: { value: 0 },
      uRotation: { value: 0 },
      uRingGap: { value: 1.6 },
      uFadeIn: { value: 0.5 },
      uFadeOut: { value: 0.75 },
      uMouse: { value: new THREE.Vector2() },
      uMouseInfluence: { value: 0 },
      uHoverAmount: { value: 0 },
      uHoverScale: { value: 1 },
      uParallax: { value: 0 },
      uBurst: { value: 0 },
    };

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      transparent: true,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    scene.add(quad);

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      const dpr = Math.min(window.devicePixelRatio, 2);
      renderer.setSize(w, h);
      renderer.setPixelRatio(dpr);
      uniforms.uResolution.value.set(w * dpr, h * dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    const onMouseMove = (e) => {
      const rect = mount.getBoundingClientRect();
      mouseRef.current[0] = (e.clientX - rect.left) / rect.width - 0.5;
      mouseRef.current[1] = -((e.clientY - rect.top) / rect.height - 0.5);
    };
    const onMouseEnter = () => {
      isHoveredRef.current = true;
    };
    const onMouseLeave = () => {
      isHoveredRef.current = false;
      mouseRef.current[0] = 0;
      mouseRef.current[1] = 0;
    };
    const onClick = () => {
      burstRef.current = 1;
    };

    mount.addEventListener("mousemove", onMouseMove);
    mount.addEventListener("mouseenter", onMouseEnter);
    mount.addEventListener("mouseleave", onMouseLeave);
    mount.addEventListener("click", onClick);

    let frameId;
    const animate = (t) => {
      frameId = requestAnimationFrame(animate);
      const p = propsRef.current;

      smoothMouseRef.current[0] +=
        (mouseRef.current[0] - smoothMouseRef.current[0]) * 0.08;
      smoothMouseRef.current[1] +=
        (mouseRef.current[1] - smoothMouseRef.current[1]) * 0.08;
      hoverAmountRef.current +=
        ((isHoveredRef.current ? 1 : 0) - hoverAmountRef.current) * 0.08;
      burstRef.current *= 0.95;
      if (burstRef.current < 0.001) burstRef.current = 0;

      uniforms.uTime.value = t * 0.001 * p.speed;
      uniforms.uAttenuation.value = p.attenuation;
      uniforms.uColor.value.set(p.color);
      uniforms.uColorTwo.value.set(p.colorTwo);
      uniforms.uLineThickness.value = p.lineThickness;
      uniforms.uBaseRadius.value = p.baseRadius;
      uniforms.uRadiusStep.value = p.radiusStep;
      uniforms.uScaleRate.value = p.scaleRate;
      uniforms.uRingCount.value = p.ringCount;
      uniforms.uOpacity.value = p.opacity;
      uniforms.uNoiseAmount.value = p.noiseAmount;
      uniforms.uRotation.value = (p.rotation * Math.PI) / 180;
      uniforms.uRingGap.value = p.ringGap;
      uniforms.uFadeIn.value = p.fadeIn;
      uniforms.uFadeOut.value = p.fadeOut;
      uniforms.uMouse.value.set(
        smoothMouseRef.current[0],
        smoothMouseRef.current[1],
      );
      uniforms.uMouseInfluence.value = p.followMouse ? p.mouseInfluence : 0;
      uniforms.uHoverAmount.value = hoverAmountRef.current;
      uniforms.uHoverScale.value = p.hoverScale;
      uniforms.uParallax.value = p.parallax;
      uniforms.uBurst.value = p.clickBurst ? burstRef.current : 0;

      renderer.render(scene, camera);
    };
    frameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
      ro.disconnect();
      mount.removeEventListener("mousemove", onMouseMove);
      mount.removeEventListener("mouseenter", onMouseEnter);
      mount.removeEventListener("mouseleave", onMouseLeave);
      mount.removeEventListener("click", onClick);
      mount.removeChild(renderer.domElement);
      renderer.dispose();
      material.dispose();
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className="w-full h-full"
      style={blur > 0 ? { filter: `blur(${blur}px)` } : undefined}
    />
  );
}
```

### Integration Instructions

1. Install any listed dependencies.
2. Copy the component source into the appropriate directory in the project.
3. Import and render the component using the usage example above as a starting point.
4. Adjust props as needed for the specific use case — refer to the props table for all available options.

# ORBIT IMAGES

## Integrate the <OrbitImages /> component from React Bits

You are helping integrate an open-source React component into an existing application.

### Component: OrbitImages

### Variant: JavaScript + Tailwind

### Dependencies: motion

---

### Usage Example

```jsx
// Component created by Dominik Koch
// https://x.com/dominikkoch

import OrbitImages from "./OrbitImages";

const images = [
  "https://picsum.photos/300/300?grayscale&random=1",
  "https://picsum.photos/300/300?grayscale&random=2",
  "https://picsum.photos/300/300?grayscale&random=3",
  "https://picsum.photos/300/300?grayscale&random=4",
  "https://picsum.photos/300/300?grayscale&random=5",
  "https://picsum.photos/300/300?grayscale&random=6",
];

<OrbitImages
  images={images}
  shape="ellipse"
  radiusX={340}
  radiusY={80}
  rotation={-8}
  duration={30}
  itemSize={80}
  responsive={true}
/>;
```

### Props

| Prop           | Type      | Default           | Description                                                                                         |
| -------------- | --------- | ----------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------- |
| images         | string[]  | []                | Array of image URLs to orbit along the path.                                                        |
| altPrefix      | string    | "Orbiting image"  | Prefix for auto-generated alt attributes.                                                           |
| shape          | string    | "ellipse"         | Preset shape: ellipse, circle, square, rectangle, triangle, star, heart, infinity, wave, or custom. |
| customPath     | string    | undefined         | Custom SVG path string (used when shape="custom").                                                  |
| baseWidth      | number    | 1400              | Base width for the design coordinate space used for responsive scaling.                             |
| radiusX        | number    | 700               | Horizontal radius for ellipse/rectangle shapes.                                                     |
| radiusY        | number    | 170               | Vertical radius for ellipse/rectangle shapes.                                                       |
| radius         | number    | 300               | Radius for circle, square, triangle, star, heart shapes.                                            |
| starPoints     | number    | 5                 | Number of points for star shape.                                                                    |
| starInnerRatio | number    | 0.5               | Inner radius ratio for star (0-1).                                                                  |
| rotation       | number    | -8                | Rotation angle of the entire orbit path in degrees.                                                 |
| duration       | number    | 40                | Duration of one complete orbit in seconds.                                                          |
| itemSize       | number    | 64                | Width/height of each orbiting item in pixels.                                                       |
| direction      | string    | "normal"          | Animation direction: "normal" or "reverse".                                                         |
| fill           | boolean   | true              | Whether to distribute items evenly around the orbit.                                                |
| width          | number    | "100%"            | 100                                                                                                 | Container width in pixels or "100%".  |
| height         | number    | "auto"            | 100                                                                                                 | Container height in pixels or "auto". |
| className      | string    | ""                | Additional CSS class for the container.                                                             |
| showPath       | boolean   | false             | Whether to show the orbit path for debugging.                                                       |
| pathColor      | string    | "rgba(0,0,0,0.1)" | Stroke color when showPath is true.                                                                 |
| pathWidth      | number    | 2                 | Stroke width when showPath is true.                                                                 |
| easing         | string    | "linear"          | Animation easing: linear, easeIn, easeOut, easeInOut.                                               |
| paused         | boolean   | false             | Whether the animation is paused.                                                                    |
| centerContent  | ReactNode | undefined         | Custom content rendered at the center of the orbit.                                                 |
| responsive     | boolean   | false             | Enable responsive scaling based on container width.                                                 |

### Full Component Source

```jsx
// Component created by Dominik Koch
// https://x.com/dominikkoch

import { useMemo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, useMotionValue, useTransform, animate } from "motion/react";

function generateEllipsePath(cx, cy, rx, ry) {
  return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy}`;
}

function generateCirclePath(cx, cy, r) {
  return generateEllipsePath(cx, cy, r, r);
}

function generateSquarePath(cx, cy, size) {
  const h = size / 2;
  return `M ${cx - h} ${cy - h} L ${cx + h} ${cy - h} L ${cx + h} ${cy + h} L ${cx - h} ${cy + h} Z`;
}

function generateRectanglePath(cx, cy, w, h) {
  const hw = w / 2;
  const hh = h / 2;
  return `M ${cx - hw} ${cy - hh} L ${cx + hw} ${cy - hh} L ${cx + hw} ${cy + hh} L ${cx - hw} ${cy + hh} Z`;
}

function generateTrianglePath(cx, cy, size) {
  const height = (size * Math.sqrt(3)) / 2;
  const hs = size / 2;
  return `M ${cx} ${cy - height / 1.5} L ${cx + hs} ${cy + height / 3} L ${cx - hs} ${cy + height / 3} Z`;
}

function generateStarPath(cx, cy, outerR, innerR, points) {
  const step = Math.PI / points;
  let path = "";
  for (let i = 0; i < 2 * points; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = i * step - Math.PI / 2;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    path += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
  }
  return path + " Z";
}

function generateHeartPath(cx, cy, size) {
  const s = size / 30;
  return `M ${cx} ${cy + 12 * s} C ${cx - 20 * s} ${cy - 5 * s}, ${cx - 12 * s} ${cy - 18 * s}, ${cx} ${cy - 8 * s} C ${cx + 12 * s} ${cy - 18 * s}, ${cx + 20 * s} ${cy - 5 * s}, ${cx} ${cy + 12 * s}`;
}

function generateInfinityPath(cx, cy, w, h) {
  const hw = w / 2;
  const hh = h / 2;
  return `M ${cx} ${cy} C ${cx + hw * 0.5} ${cy - hh}, ${cx + hw} ${cy - hh}, ${cx + hw} ${cy} C ${cx + hw} ${cy + hh}, ${cx + hw * 0.5} ${cy + hh}, ${cx} ${cy} C ${cx - hw * 0.5} ${cy + hh}, ${cx - hw} ${cy + hh}, ${cx - hw} ${cy} C ${cx - hw} ${cy - hh}, ${cx - hw * 0.5} ${cy - hh}, ${cx} ${cy}`;
}

function generateWavePath(cx, cy, w, amplitude, waves) {
  const pts = [];
  const segs = waves * 20;
  const hw = w / 2;
  for (let i = 0; i <= segs; i++) {
    const x = cx - hw + (w * i) / segs;
    const y = cy + Math.sin((i / segs) * waves * 2 * Math.PI) * amplitude;
    pts.push(i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`);
  }
  for (let i = segs; i >= 0; i--) {
    const x = cx - hw + (w * i) / segs;
    const y = cy - Math.sin((i / segs) * waves * 2 * Math.PI) * amplitude;
    pts.push(`L ${x} ${y}`);
  }
  return pts.join(" ") + " Z";
}

function OrbitItem({
  item,
  index,
  totalItems,
  path,
  itemSize,
  rotation,
  progress,
  fill,
}) {
  const itemOffset = fill ? (index / totalItems) * 100 : 0;

  const offsetDistance = useTransform(progress, (p) => {
    const offset = (((p + itemOffset) % 100) + 100) % 100;
    return `${offset}%`;
  });

  return (
    <motion.div
      className="absolute will-change-transform select-none"
      style={{
        width: itemSize,
        height: itemSize,
        offsetPath: `path("${path}")`,
        offsetRotate: "0deg",
        offsetAnchor: "center center",
        offsetDistance,
      }}
    >
      <div style={{ transform: `rotate(${-rotation}deg)` }}>{item}</div>
    </motion.div>
  );
}

export default function OrbitImages({
  images = [],
  altPrefix = "Orbiting image",
  shape = "ellipse",
  customPath,
  baseWidth = 1400,
  radiusX = 700,
  radiusY = 170,
  radius = 300,
  starPoints = 5,
  starInnerRatio = 0.5,
  rotation = -8,
  duration = 40,
  itemSize = 64,
  direction = "normal",
  fill = true,
  width = 100,
  height = 100,
  className = "",
  showPath = false,
  pathColor = "rgba(0,0,0,0.1)",
  pathWidth = 2,
  easing = "linear",
  paused = false,
  centerContent,
  responsive = false,
}) {
  const containerRef = useRef(null);
  const [scale, setScale] = useState(null);

  const designCenterX = baseWidth / 2;
  const designCenterY = baseWidth / 2;

  const path = useMemo(() => {
    switch (shape) {
      case "circle":
        return generateCirclePath(designCenterX, designCenterY, radius);
      case "ellipse":
        return generateEllipsePath(
          designCenterX,
          designCenterY,
          radiusX,
          radiusY,
        );
      case "square":
        return generateSquarePath(designCenterX, designCenterY, radius * 2);
      case "rectangle":
        return generateRectanglePath(
          designCenterX,
          designCenterY,
          radiusX * 2,
          radiusY * 2,
        );
      case "triangle":
        return generateTrianglePath(designCenterX, designCenterY, radius * 2);
      case "star":
        return generateStarPath(
          designCenterX,
          designCenterY,
          radius,
          radius * starInnerRatio,
          starPoints,
        );
      case "heart":
        return generateHeartPath(designCenterX, designCenterY, radius * 2);
      case "infinity":
        return generateInfinityPath(
          designCenterX,
          designCenterY,
          radiusX * 2,
          radiusY * 2,
        );
      case "wave":
        return generateWavePath(
          designCenterX,
          designCenterY,
          radiusX * 2,
          radiusY,
          3,
        );
      case "custom":
        return (
          customPath || generateCirclePath(designCenterX, designCenterY, radius)
        );
      default:
        return generateEllipsePath(
          designCenterX,
          designCenterY,
          radiusX,
          radiusY,
        );
    }
  }, [
    shape,
    customPath,
    designCenterX,
    designCenterY,
    radiusX,
    radiusY,
    radius,
    starPoints,
    starInnerRatio,
  ]);

  useLayoutEffect(() => {
    if (!responsive || !containerRef.current) return;
    const updateScale = () => {
      if (!containerRef.current) return;
      setScale(containerRef.current.clientWidth / baseWidth);
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [responsive, baseWidth]);

  const progress = useMotionValue(0);

  useEffect(() => {
    if (paused) return;
    const controls = animate(progress, direction === "reverse" ? -100 : 100, {
      duration,
      ease: easing,
      repeat: Infinity,
      repeatType: "loop",
    });
    return () => controls.stop();
  }, [progress, duration, easing, direction, paused]);

  const containerWidth = responsive
    ? "100%"
    : typeof width === "number"
      ? width
      : "100%";
  const containerHeight = responsive
    ? "auto"
    : typeof height === "number"
      ? height
      : typeof width === "number"
        ? width
        : "auto";

  const items = images.map((src, index) => (
    <img
      key={src}
      src={src}
      alt={`${altPrefix} ${index + 1}`}
      draggable={false}
      className="w-full h-full object-contain"
    />
  ));

  return (
    <div
      ref={containerRef}
      className={`relative mx-auto ${className}`}
      style={{
        width: containerWidth,
        height: containerHeight,
        aspectRatio: responsive ? "1 / 1" : undefined,
      }}
      aria-hidden="true"
    >
      <div
        className={
          responsive ? "absolute left-1/2 top-1/2" : "relative w-full h-full"
        }
        style={{
          width: responsive ? baseWidth : "100%",
          height: responsive ? baseWidth : "100%",
          transform:
            responsive && scale !== null
              ? `translate(-50%, -50%) scale(${scale})`
              : undefined,
          visibility: responsive && scale === null ? "hidden" : undefined,
          transformOrigin: "center center",
        }}
      >
        <div
          className="relative w-full h-full"
          style={{
            transform: `rotate(${rotation}deg)`,
            transformOrigin: "center center",
          }}
        >
          {showPath && (
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${baseWidth} ${baseWidth}`}
              className="absolute inset-0 pointer-events-none"
            >
              <path
                d={path}
                fill="none"
                stroke={pathColor}
                strokeWidth={pathWidth / (scale ?? 1)}
              />
            </svg>
          )}

          {items.map((item, index) => (
            <OrbitItem
              key={index}
              item={item}
              index={index}
              totalItems={items.length}
              path={path}
              itemSize={itemSize}
              rotation={rotation}
              progress={progress}
              fill={fill}
            />
          ))}
        </div>
      </div>

      {centerContent && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          {centerContent}
        </div>
      )}
    </div>
  );
}
```

### Integration Instructions

1. Install any listed dependencies.
2. Copy the component source into the appropriate directory in the project.
3. Import and render the component using the usage example above as a starting point.
4. Adjust props as needed for the specific use case — refer to the props table for all available options.
