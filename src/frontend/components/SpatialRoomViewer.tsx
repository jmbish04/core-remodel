import { OrbitControls, useTexture } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { EffectComposer, Vignette, Bloom, BrightnessContrast } from "@react-three/postprocessing";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import React, { useState, Suspense, useMemo } from "react";
import * as THREE from "three";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ListingImage {
  id: string;
  displayName?: string | null;
  cfImageIdOriginal: string;
  cfImageIdOptimized?: string | null;
  metadata?: string | null;
  roomId?: number | null;
  roomType?: string | null;
  roomIds?: number[];
  roomLabels?: string[];
  datetimeCreated?: string | number | Date | null;
}

interface SpatialRoomViewerProps {
  images: ListingImage[];
  resolveImageUrl: (image: ListingImage) => string;
  roomName?: string;
}

// Sub-component for projecting the specific image
function ImageScene({ url }: { url: string }) {
  const texture = useTexture(url);

  const aspect = useMemo(() => {
    if (!texture.image) return 16 / 9;
    return (texture.image as HTMLImageElement).width / (texture.image as HTMLImageElement).height;
  }, [texture]);

  // Configure texture for better rendering
  useMemo(() => {
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
  }, [texture]);

  return (
    <>
      {/* Ambient and directional lighting for depth */}
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 5, 5]} intensity={0.8} />
      <directionalLight position={[-5, -5, -5]} intensity={0.3} />

      {/* The main image plane */}
      <mesh position={[0, 0, 0]}>
        <planeGeometry args={[aspect * 8, 8]} />
        <meshStandardMaterial map={texture} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>

      {/* Subtle backplane for depth */}
      <mesh position={[0, 0, -2]} receiveShadow>
        <planeGeometry args={[aspect * 8.5, 8.5]} />
        <meshStandardMaterial color="#0a0a0a" metalness={0.2} roughness={0.8} />
      </mesh>
    </>
  );
}

function LoadingFallback() {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#333333" />
    </mesh>
  );
}

export function SpatialRoomViewer({ images, resolveImageUrl, roomName }: SpatialRoomViewerProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  const activeImage = images[activeIndex];
  const activeUrl = activeImage ? resolveImageUrl(activeImage) : "";

  const handlePrevious = () => {
    setActiveIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
  };

  const handleNext = () => {
    setActiveIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
  };

  return (
    <div className="relative h-[600px] w-full overflow-hidden rounded-xl border border-border/50 bg-black">
      <Canvas
        camera={{
          position: [0, 0, 12],
          fov: 50,
        }}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.2,
        }}
      >
        <Suspense fallback={<LoadingFallback />}>
          {activeUrl && <ImageScene url={activeUrl} />}
        </Suspense>

        <OrbitControls
          enableZoom={true}
          enablePan={false}
          maxDistance={25}
          minDistance={3}
          minAzimuthAngle={-Math.PI / 4}
          maxAzimuthAngle={Math.PI / 4}
          minPolarAngle={Math.PI / 3}
          maxPolarAngle={(2 * Math.PI) / 3}
          enableDamping={true}
          dampingFactor={0.05}
        />

        <EffectComposer>
          <Vignette offset={0.3} darkness={0.5} />
          <Bloom intensity={0.4} luminanceThreshold={0.9} luminanceSmoothing={0.9} />
          <BrightnessContrast brightness={0.05} contrast={0.1} />
        </EffectComposer>
      </Canvas>

      {/* HUD Overlay - Bottom Navigation */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-6">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePrevious}
            disabled={images.length <= 1}
            className={cn(
              "text-white hover:bg-white/20 hover:text-white",
              images.length <= 1 && "opacity-30",
            )}
          >
            <ChevronLeft className="mr-1 size-4" />
            Previous
          </Button>

          <div className="flex flex-col items-center gap-1 text-center">
            <p className="text-sm font-medium text-white">
              {activeImage?.displayName?.trim() || roomName || "Listing Photo"}
            </p>
            <p className="text-xs text-white/70">
              {activeIndex + 1} of {images.length}
            </p>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleNext}
            disabled={images.length <= 1}
            className={cn(
              "text-white hover:bg-white/20 hover:text-white",
              images.length <= 1 && "opacity-30",
            )}
          >
            Next
            <ChevronRight className="ml-1 size-4" />
          </Button>
        </div>

        {/* Thumbnail indicators */}
        {images.length > 1 && (
          <div className="mt-4 flex items-center justify-center gap-1.5">
            {images.map((_, index) => (
              <button
                key={`indicator-${index}`}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={cn(
                  "size-2 rounded-full transition-all",
                  index === activeIndex ? "w-6 bg-white" : "bg-white/40 hover:bg-white/60",
                )}
                title={`View photo ${index + 1}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Loading overlay when switching images */}
      <Suspense
        fallback={
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <Loader2 className="size-8 animate-spin text-white" />
          </div>
        }
      >
        <div className="hidden" />
      </Suspense>
    </div>
  );
}
