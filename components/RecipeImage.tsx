import Image from 'next/image';

/**
 * A recipe's photo, filling its (relative, sized) parent. Recipes without a
 * photo get a quiet panel with the dish's initial instead of a stock image
 * of some other dish.
 */
export default function RecipeImage({
  src, name, sizes, className = 'object-cover', priority = false, initialClassName = 'text-5xl'
}: {
  src: string | null | undefined;
  name: string;
  sizes: string;
  className?: string;
  priority?: boolean;
  /** Size of the initial in the no-photo panel. */
  initialClassName?: string;
}) {
  if (src) return <Image src={src} alt={name} fill priority={priority} sizes={sizes} className={className} />;
  return (
    <div aria-label={name} role="img" className="absolute inset-0 flex items-center justify-center bg-beige-100">
      <span className={`font-display italic text-maroon-300 select-none ${initialClassName}`}>
        {name.trim().charAt(0).toUpperCase() || 'S'}
      </span>
    </div>
  );
}
