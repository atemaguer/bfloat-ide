export default function Home() {
  return (
    <div className="min-h-screen p-8 pb-20 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="max-w-2xl mx-auto flex flex-col items-center justify-center min-h-[60vh]">
        <h1 className="text-4xl font-bold mb-4 text-center">Welcome!</h1>
        <p className="text-xl text-gray-600 dark:text-gray-300 text-center mb-8">Your Next.js app is ready to go.</p>

        <div className="p-6 bg-blue-50 dark:bg-blue-900/20 rounded-lg max-w-md">
          <p className="text-gray-600 dark:text-gray-300 text-center">
            Start editing <code className="bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded">app/page.tsx</code> to build
            your app.
          </p>
        </div>

        <div className="mt-12 p-6 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <h2 className="text-xl font-semibold mb-4">This template includes:</h2>
          <ul className="space-y-2 text-gray-600 dark:text-gray-300">
            <li>• Next.js 15 with App Router</li>
            <li>• Tailwind CSS for styling</li>
            <li>• TypeScript for type safety</li>
          </ul>
        </div>
      </main>
    </div>
  );
}
