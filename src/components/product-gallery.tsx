type GalleryImage = { url: string; altText: string };

// A plain, always-visible image stack — every shot is on the page at once,
// so the gallery needs no client JS to switch between them (specs/03-
// storefront.md's "page works with JS disabled" requirement). A click-to-
// swap main image is a reasonable follow-up, not required by 2.5's AC.
export function ProductGallery({
  images,
  productName,
}: {
  images: GalleryImage[];
  productName: string;
}) {
  if (images.length === 0) {
    return (
      <div className="aspect-square w-full shrink-0 rounded-md bg-sand lg:w-96">
        <div className="flex h-full w-full items-center justify-center text-sm text-ink/50">
          No image available for {productName}
        </div>
      </div>
    );
  }

  const [primary, ...rest] = images;

  return (
    <div className="w-full shrink-0 lg:w-96">
      <div className="aspect-square overflow-hidden rounded-md bg-sand">
        {/* eslint-disable-next-line @next/next/no-img-element -- real image hosting/next-image sizing lands in 4.5/5.4 */}
        <img
          src={primary!.url}
          alt={primary!.altText}
          className="h-full w-full object-cover"
        />
      </div>
      {rest.length > 0 && (
        <div className="mt-3 grid grid-cols-4 gap-3">
          {rest.map((image) => (
            <div
              key={image.url}
              className="aspect-square overflow-hidden rounded-md bg-sand"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
              <img
                src={image.url}
                alt={image.altText}
                className="h-full w-full object-cover"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
