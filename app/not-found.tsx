import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <p className="font-display text-8xl text-maroon-900 leading-none mb-4">404</p>
        <h1 className="font-display text-2xl text-maroon-900 mb-3">Recipe not found.</h1>
        <p className="text-beige-700 mb-8">
          The recipe you're looking for may have been deleted, or you may not have access to it.
        </p>
        <Link
          href="/library"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium"
        >
          Back to library
        </Link>
      </div>
    </main>
  );
}
