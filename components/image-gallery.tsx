import { LazyImage } from "@/components/lazy-image";

const GALLERY_COLUMNS = 4;
const GALLERY_ROWS_PER_COLUMN = 8;

function isPortraitTile(columnIndex: number, rowIndex: number): boolean {
  return (columnIndex + rowIndex) % 2 === 0;
}

export function ImageGallery() {
  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center px-4 py-10">
      <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4 md:gap-6">
        {Array.from({ length: GALLERY_COLUMNS }).map((_, col) => (
          <div className="grid gap-4" key={col}>
            {Array.from({ length: GALLERY_ROWS_PER_COLUMN }).map((_, index) => {
              const isPortrait = isPortraitTile(col, index);
              const width = isPortrait ? 1080 : 1920;
              const height = isPortrait ? 1920 : 1080;
              const ratio = isPortrait ? 9 / 16 : 16 / 9;

              return (
                <LazyImage
                  alt={`Image ${col}-${index}`}
                  containerClassName="cn-rounded"
                  fallback={`https://placehold.co/${width}x${height}/`}
                  inView={true}
                  key={`${col}-${index}`}
                  ratio={ratio}
                  src={`https://picsum.photos/seed/${col}-${index}/${width}/${height}`}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
